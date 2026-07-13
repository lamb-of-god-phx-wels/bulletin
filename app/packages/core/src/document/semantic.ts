/**
 * Pure cross-tree semantic validation for structurally valid v1 documents.
 *
 * JSON Schema remains responsible for closed shapes and primitive constraints.
 * This module handles document-wide identity, topology, reference, contract,
 * value, and rule invariants that require more than one record at a time.
 */

import type { SemanticDiagnostic, SemanticValidationResult } from "../schema/types.js";
import type {
  Binding,
  CbbDocument,
  ConditionalRule,
  ContentRule,
  CustomElementDefinition,
  FieldContract,
  FieldDefinition,
  FieldValueEntry,
  FieldValues,
  NativeElement,
  PageLevelWrapper,
  RepeatRule,
} from "./types.js";
import {
  churchProfileKeyAcceptsFieldType,
  DOCUMENT_LIMITS,
} from "./types.js";
import {
  isSafeFieldPattern,
  matchesSafeFieldPattern,
} from "./safePattern.js";
import { isRichTextDocument } from "../richtext/index.js";
import { resolveEffectiveField } from "../resolve/field.js";
import { customElementDefinitionHash } from "./customDefinitions.js";

const CODE = {
  duplicateNode: "CBB-DOC-0100",
  nodeLimit: "CBB-DOC-0101",
  customReference: "CBB-DOC-0102",
  customCycle: "CBB-DOC-0103",
  customPin: "CBB-DOC-0104",
  pageBreak: "CBB-LAYOUT-0100",
  containerDepth: "CBB-LAYOUT-0101",
  stack: "CBB-LAYOUT-0102",
  grid: "CBB-LAYOUT-0103",
  canvas: "CBB-LAYOUT-0104",
  pageTarget: "CBB-LAYOUT-0105",
  contract: "CBB-FIELD-0100",
  fieldValue: "CBB-FIELD-0101",
  binding: "CBB-FIELD-0102",
  rule: "CBB-FIELD-0103",
  ruleCycle: "CBB-FIELD-0104",
} as const;

type NodeKind = "element" | "wrapper" | "pageWrapper" | "definition";

interface NodeRecord {
  readonly id: string;
  readonly path: string;
  readonly idPath: string;
  readonly kind: NodeKind;
  readonly scopeKey: string;
  readonly collectionPath: string;
  readonly ancestors: readonly string[];
  readonly element?: NativeElement;
}

interface FieldRecord {
  readonly definition: FieldDefinition;
  readonly path: string;
}

interface ContractInfo {
  readonly contract: FieldContract;
  readonly path: string;
  readonly fields: ReadonlyMap<string, FieldRecord>;
  readonly groupRuleRefs: readonly { readonly ruleId: string; readonly path: string }[];
}

interface ValueStoreInfo {
  readonly values: FieldValues;
  readonly path: string;
  readonly contract: ContractInfo;
  readonly ruleScopeKey?: string;
  readonly requireRepeatItemIds: boolean;
}

interface CustomUse {
  readonly definitionId: string;
  readonly definitionVersion: unknown;
  readonly definitionHash: unknown;
  readonly path: string;
  readonly scopeKey: string;
}

interface RuleContext {
  readonly scopeKey: string;
  readonly path: string;
  readonly rules: readonly ContentRule[];
  readonly contract: ContractInfo | undefined;
  readonly valueStores: readonly ValueStoreInfo[];
}

interface RuleUse {
  readonly rule: ContentRule;
  readonly path: string;
  readonly context: RuleContext;
}

interface RepeatUse extends RuleUse {
  readonly rule: RepeatRule;
  readonly prototype?: NodeRecord;
  readonly field?: FieldRecord;
}

interface ConditionalUse extends RuleUse {
  readonly rule: ConditionalRule;
  readonly target?: NodeRecord;
}

interface EmptyStateUse {
  readonly repeat: RepeatUse;
  readonly node: NodeRecord;
  readonly path: string;
}

type StaticSinglePageTarget = number | "last";

const ASSET_REF_RE =
  /^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodePointer(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const output: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(raw)) return undefined;
    output.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return output;
}

function readPointer(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isIsoDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

class DocumentSemanticValidator {
  private readonly findings: SemanticDiagnostic[] = [];
  private readonly firstNodeById = new Map<string, NodeRecord>();
  private readonly elementsByScope = new Map<string, Map<string, NodeRecord>>();
  private readonly definitionsById = new Map<string, { definition: CustomElementDefinition; index: number }>();
  private readonly definitionContracts = new Map<number, ContractInfo>();
  private readonly customUses: CustomUse[] = [];
  private readonly semanticRoles = new Map<string, string>();
  private readonly bindingIds = new Map<string, string>();
  private readonly valueStores: ValueStoreInfo[] = [];
  private readonly valueStoresByRuleScope = new Map<string, ValueStoreInfo[]>();
  private readonly localContracts: ContractInfo[] = [];
  private readonly localContractByOwnerId = new Map<string, ContractInfo>();
  private nodeCount = 0;
  private deepestContainer: { depth: number; path: string } = { depth: 0, path: "" };
  private documentContract: ContractInfo | undefined;

  constructor(private readonly document: CbbDocument) {}

  run(): SemanticValidationResult {
    this.indexDefinitionsAndContracts();
    this.documentContract = this.document.fieldContract === undefined
      ? undefined
      : this.validateContract(this.document.fieldContract, "/fieldContract");

    if (this.document.fieldValues !== undefined) {
      this.addValueStore(
        this.document.fieldValues,
        "/fieldValues",
        this.documentContract,
        "document",
        this.document.kind === "bulletin",
      );
    }
    if (this.document.sampleFieldValues !== undefined) {
      this.addValueStore(
        this.document.sampleFieldValues,
        "/sampleFieldValues",
        this.documentContract,
        "document",
        false,
      );
    }

    for (let index = 0; index < this.document.elements.length; index++) {
      this.visitElement(
        this.document.elements[index] as NativeElement,
        `/elements/${index}`,
        "document",
        "/elements",
        [],
        0,
        true,
        undefined,
      );
    }

    for (let index = 0; index < (this.document.pageElements?.length ?? 0); index++) {
      const wrapper = this.document.pageElements?.[index] as PageLevelWrapper;
      const path = `/pageElements/${index}`;
      this.registerNode({
        id: wrapper.id,
        path,
        idPath: `${path}/id`,
        kind: "pageWrapper",
        scopeKey: "document",
        collectionPath: "/pageElements",
        ancestors: [],
      });
      this.validatePageTarget(wrapper, path);
      this.visitElement(
        wrapper.element as NativeElement,
        `${path}/element`,
        "document",
        `${path}/element`,
        [],
        0,
        false,
        undefined,
      );
    }
    this.validatePageContentOrder();

    for (let index = 0; index < (this.document.customElementDefinitions?.length ?? 0); index++) {
      const definition = this.document.customElementDefinitions?.[index] as CustomElementDefinition;
      const path = `/customElementDefinitions/${index}`;
      const scopeKey = `definition:${index}`;
      if (!Number.isSafeInteger(definition.definitionVersion) || definition.definitionVersion < 1) {
        this.add(CODE.customPin, `${path}/definitionVersion`, "Definition revision must be a positive safe integer.");
      } else if (customElementDefinitionHash(definition) !== definition.definitionHash) {
        this.add(CODE.customPin, `${path}/definitionHash`, "Definition self-hash does not match its canonical revision.");
      }
      this.registerNode({
        id: definition.id,
        path,
        idPath: `${path}/id`,
        kind: "definition",
        scopeKey,
        collectionPath: "/customElementDefinitions",
        ancestors: [],
      });
      const definitionContract = this.definitionContracts.get(index);
      if (definition.sampleFieldValues !== undefined) {
        this.addValueStore(
          definition.sampleFieldValues,
          `${path}/sampleFieldValues`,
          definitionContract,
          scopeKey,
          false,
        );
      }
      for (let elementIndex = 0; elementIndex < definition.elements.length; elementIndex++) {
        this.visitElement(
          definition.elements[elementIndex] as NativeElement,
          `${path}/elements/${elementIndex}`,
          scopeKey,
          `${path}/elements`,
          [],
          0,
          false,
          definitionContract,
        );
      }
    }

    if (this.nodeCount > DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP) {
      this.add(
        CODE.nodeLimit,
        "",
        `Persisted visual node count ${this.nodeCount} exceeds hard cap ${DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP}.`,
      );
    }
    if (this.deepestContainer.depth > DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP) {
      this.add(
        CODE.containerDepth,
        this.deepestContainer.path,
        `Container nesting depth ${this.deepestContainer.depth} exceeds hard cap ${DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP}.`,
      );
    }

    this.validateCustomReferencesAndCycles();
    this.validateRules();
    this.validateReviewTargets();
    this.validateSemanticRoleMetadataMirrors();

    this.findings.sort((left, right) => {
      const pathOrder = compareText(left.instancePath ?? "", right.instancePath ?? "");
      if (pathOrder !== 0) return pathOrder;
      const codeOrder = compareText(left.code, right.code);
      return codeOrder !== 0 ? codeOrder : compareText(left.message, right.message);
    });
    return this.findings.length === 0
      ? { valid: true, findings: this.findings }
      : { valid: false, findings: this.findings };
  }

  private add(code: string, instancePath: string, message: string): void {
    this.findings.push({ code, severity: "error", instancePath, message });
  }

  private indexDefinitionsAndContracts(): void {
    for (let index = 0; index < (this.document.customElementDefinitions?.length ?? 0); index++) {
      const definition = this.document.customElementDefinitions?.[index] as CustomElementDefinition;
      if (!this.definitionsById.has(definition.id)) {
        this.definitionsById.set(definition.id, { definition, index });
      }
      const contract = this.validateContract(
        definition.fieldContract,
        `/customElementDefinitions/${index}/fieldContract`,
      );
      this.definitionContracts.set(index, contract);
    }
  }

  private registerNode(node: NodeRecord): void {
    this.nodeCount++;
    const prior = this.firstNodeById.get(node.id);
    if (prior === undefined) {
      this.firstNodeById.set(node.id, node);
    } else {
      this.add(
        CODE.duplicateNode,
        node.idPath,
        `Node id "${node.id}" duplicates the node at ${prior.idPath}.`,
      );
    }
    if (node.kind === "element") {
      let scope = this.elementsByScope.get(node.scopeKey);
      if (scope === undefined) {
        scope = new Map<string, NodeRecord>();
        this.elementsByScope.set(node.scopeKey, scope);
      }
      if (!scope.has(node.id)) scope.set(node.id, node);
    }
  }

  private visitElement(
    element: NativeElement,
    path: string,
    scopeKey: string,
    collectionPath: string,
    ancestors: readonly string[],
    parentContainerDepth: number,
    directBody: boolean,
    inheritedLocalContract: ContractInfo | undefined,
  ): void {
    this.registerNode({
      id: element.id,
      path,
      idPath: `${path}/id`,
      kind: "element",
      scopeKey,
      collectionPath,
      ancestors,
      element,
    });

    if (element.type === "pageBreak" && !directBody) {
      this.add(CODE.pageBreak, `${path}/type`, "Page-break elements are legal only as direct body children.");
    }

    if (
      element.type === "rightsAttribution" &&
      (new Set(element.data.groupOrder).size !== 3 ||
        !["scripture", "music", "other"].every((group) =>
          element.data.groupOrder.includes(group as (typeof element.data.groupOrder)[number])
        ))
    ) {
      this.add(
        "CBB-RIGHTS-0002",
        `${path}/data/groupOrder`,
        "Rights group order must contain scripture, music, and other exactly once.",
      );
    }

    let ownContract: ContractInfo | undefined;
    if ("fieldContract" in element && element.fieldContract !== undefined) {
      ownContract = this.validateContract(element.fieldContract, `${path}/fieldContract`);
      this.localContracts.push(ownContract);
      if (!this.localContractByOwnerId.has(element.id)) {
        this.localContractByOwnerId.set(element.id, ownContract);
      }
    }
    const bindingContract = ownContract ?? inheritedLocalContract;
    if (
      element.type !== "customInstance" &&
      "fieldValues" in element &&
      element.fieldValues !== undefined
    ) {
      this.addValueStore(
        element.fieldValues,
        `${path}/fieldValues`,
        ownContract,
        undefined,
        this.document.kind === "bulletin",
      );
    }
    if ("bindings" in element && element.bindings !== undefined) {
      const priorTargets: { readonly target: string; readonly path: string }[] = [];
      for (let index = 0; index < element.bindings.length; index++) {
        const binding = element.bindings[index] as Binding;
        const segments = decodePointer(binding.target);
        const overlap = priorTargets.find((prior) => {
          const priorSegments = decodePointer(prior.target);
          if (segments === undefined || priorSegments === undefined) return false;
          const shared = Math.min(segments.length, priorSegments.length);
          return segments.slice(0, shared).every((segment, offset) =>
            segment === priorSegments[offset]);
        });
        if (overlap !== undefined) {
          this.add(
            CODE.binding,
            `${path}/bindings/${index}/target`,
            `Binding target "${binding.target}" overlaps ${overlap.path}.`,
          );
        }
        priorTargets.push({
          target: binding.target,
          path: `${path}/bindings/${index}/target`,
        });
        this.validateBinding(
          binding,
          `${path}/bindings/${index}`,
          element,
          bindingContract,
        );
      }
    }
    this.validateRequiredLiteralBindings(element, path, bindingContract);

    if (element.type === "customInstance") {
      const target = this.definitionsById.get(element.definitionId);
      const contract = target === undefined
        ? undefined
        : this.definitionContracts.get(target.index);
      if (contract !== undefined && !this.localContractByOwnerId.has(element.id)) {
        this.localContractByOwnerId.set(element.id, contract);
      }
      this.customUses.push({
        definitionId: element.definitionId,
        definitionVersion: (element as unknown as Record<string, unknown>)["definitionVersion"],
        definitionHash: (element as unknown as Record<string, unknown>)["definitionHash"],
        path,
        scopeKey,
      });
      if (element.fieldValues !== undefined) {
        this.addValueStore(
          element.fieldValues,
          `${path}/fieldValues`,
          contract,
          target === undefined ? undefined : `definition:${target.index}`,
          this.document.kind === "bulletin",
        );
      }
      return;
    }

    const isContainer = element.type === "grid" || element.type === "stack" || element.type === "canvas";
    const containerDepth = isContainer ? parentContainerDepth + 1 : parentContainerDepth;
    if (isContainer && containerDepth > this.deepestContainer.depth) {
      this.deepestContainer = { depth: containerDepth, path };
    }
    if (!isContainer) return;

    if (element.type === "grid") this.validateGrid(element, path);
    if (element.type === "stack") this.validateStack(element, path);
    if (element.type === "canvas") this.validateCanvas(element, path);

    for (const [index, wrapper] of element.children.entries()) {
      const wrapperPath = `${path}/children/${index}`;
      this.registerNode({
        id: wrapper.id,
        path: wrapperPath,
        idPath: `${wrapperPath}/id`,
        kind: "wrapper",
        scopeKey,
        collectionPath: `${path}/children`,
        ancestors: [...ancestors, element.id],
      });
      this.visitElement(
        wrapper.element,
        `${wrapperPath}/element`,
        scopeKey,
        `${path}/children`,
        [...ancestors, element.id],
        containerDepth,
        false,
        inheritedLocalContract,
      );
    }
  }

  private validateStack(element: Extract<NativeElement, { type: "stack" }>, path: string): void {
    for (let index = 0; index < element.children.length; index++) {
      if (element.children[index]?.index !== index) {
        this.add(
          CODE.stack,
          `${path}/children/${index}/index`,
          `Stack wrapper index must equal authoritative array position ${index}.`,
        );
      }
    }
  }

  private validateGrid(element: Extract<NativeElement, { type: "grid" }>, path: string): void {
    const occupied = new Map<string, string>();
    let allCoordinatesValid = true;
    for (let index = 0; index < element.children.length; index++) {
      const child = element.children[index] as (typeof element.children)[number];
      const childPath = `${path}/children/${index}`;
      const inBounds =
        child.row >= 0 &&
        child.row < element.data.rows &&
        child.column >= 0 &&
        child.column < element.data.columns;
      if (!inBounds) {
        allCoordinatesValid = false;
        this.add(
          CODE.grid,
          childPath,
          `Grid coordinate (${child.row}, ${child.column}) is outside ${element.data.rows}x${element.data.columns} bounds.`,
        );
      }
      const key = `${child.row}:${child.column}`;
      const prior = occupied.get(key);
      if (prior !== undefined) {
        this.add(CODE.grid, childPath, `Grid cell (${child.row}, ${child.column}) is already occupied at ${prior}.`);
      } else {
        occupied.set(key, childPath);
      }
    }

    if (element.data.rowTracks !== undefined && element.data.rowTracks.length !== element.data.rows) {
      this.add(CODE.grid, `${path}/data/rowTracks`, "Explicit row-track count must equal data.rows.");
    }
    if (
      element.data.columnTracks !== undefined &&
      element.data.columnTracks.length !== element.data.columns
    ) {
      this.add(CODE.grid, `${path}/data/columnTracks`, "Explicit column-track count must equal data.columns.");
    }

    const isTable = element.data.semanticRole === "table";
    if (!isTable && element.data.tableSemantics !== undefined) {
      this.add(CODE.grid, `${path}/data/tableSemantics`, "tableSemantics is allowed only when semanticRole is table.");
      return;
    }
    if (!isTable) return;
    const semantics = element.data.tableSemantics;
    if (semantics === undefined) {
      this.add(CODE.grid, `${path}/data/tableSemantics`, "Semantic table grids require tableSemantics.");
      return;
    }
    if (semantics.headerRows === 0 && semantics.headerColumns === 0) {
      this.add(CODE.grid, `${path}/data/tableSemantics`, "Semantic tables require at least one header row or header column.");
    }
    if (semantics.headerRows > element.data.rows) {
      this.add(CODE.grid, `${path}/data/tableSemantics/headerRows`, "Header-row count exceeds grid rows.");
    }
    if (semantics.headerColumns > element.data.columns) {
      this.add(CODE.grid, `${path}/data/tableSemantics/headerColumns`, "Header-column count exceeds grid columns.");
    }
    const coordinateCount = element.data.rows * element.data.columns;
    if (!Number.isSafeInteger(coordinateCount)) {
      this.add(
        CODE.grid,
        `${path}/data`,
        "Semantic-table dimensions exceed the supported safe logical-coordinate count.",
      );
    } else if (allCoordinatesValid && occupied.size !== coordinateCount) {
      this.add(
        CODE.grid,
        `${path}/children`,
        `Semantic table requires exactly one cell at all ${coordinateCount} logical coordinates; found ${occupied.size}.`,
      );
    }
  }

  private validateCanvas(element: Extract<NativeElement, { type: "canvas" }>, path: string): void {
    const withOrder = element.children.filter((child) => child.semanticOrder !== undefined);
    if (withOrder.length > 0 && withOrder.length !== element.children.length) {
      this.add(CODE.canvas, `${path}/children`, "Canvas semanticOrder must be supplied for all children or none.");
    }
    const seen = new Map<number, string>();
    for (let index = 0; index < element.children.length; index++) {
      const order = element.children[index]?.semanticOrder;
      if (order === undefined) continue;
      const orderPath = `${path}/children/${index}/semanticOrder`;
      const prior = seen.get(order);
      if (prior !== undefined) {
        this.add(CODE.canvas, orderPath, `Canvas semanticOrder ${order} duplicates ${prior}.`);
      } else {
        seen.set(order, orderPath);
      }
    }
  }

  private validatePageTarget(wrapper: PageLevelWrapper, path: string): void {
    this.validatePagePlacementMatrix(wrapper, path);
    if (wrapper.target.mode === "range") {
      if (
        !Number.isInteger(wrapper.target.start) ||
        !Number.isInteger(wrapper.target.end) ||
        wrapper.target.start < 1 ||
        wrapper.target.end < 1
      ) {
        this.add(CODE.pageTarget, `${path}/target`, "Page target ranges use positive one-based integers.");
      }
      if (wrapper.target.start > wrapper.target.end) {
        this.add(CODE.pageTarget, `${path}/target`, "Page target range start must not exceed end.");
      }
    }
    if (wrapper.target.mode !== "pages") return;
    if (wrapper.target.pages.length === 0) {
      this.add(CODE.pageTarget, `${path}/target/pages`, "Explicit page targets must not be empty.");
    }
    let previous = 0;
    const seen = new Set<number>();
    for (let index = 0; index < wrapper.target.pages.length; index++) {
      const page = wrapper.target.pages[index] as number;
      const pagePath = `${path}/target/pages/${index}`;
      if (!Number.isInteger(page) || page < 1) {
        this.add(CODE.pageTarget, pagePath, "Explicit target pages must be positive one-based integers.");
      }
      if (seen.has(page)) {
        this.add(CODE.pageTarget, pagePath, `Explicit target page ${page} is duplicated.`);
      }
      if (index > 0 && page <= previous) {
        this.add(CODE.pageTarget, pagePath, "Explicit target pages must be strictly increasing.");
      }
      seen.add(page);
      previous = page;
    }

  }

  private validatePagePlacementMatrix(wrapper: PageLevelWrapper, path: string): void {
    const marginRegions = ["topMargin", "bottomMargin", "leftMargin", "rightMargin"] as const;
    let allowedRegions: readonly PageLevelWrapper["region"][];
    let requiredLayer: PageLevelWrapper["layer"] | undefined;
    let artifactOnly = false;
    switch (wrapper.purpose) {
      case "background":
        allowedRegions = ["page"];
        requiredLayer = "background";
        artifactOnly = true;
        break;
      case "header":
        allowedRegions = ["topMargin", "leftMargin", "rightMargin"];
        requiredLayer = "overlay";
        break;
      case "footer":
        allowedRegions = ["bottomMargin", "leftMargin", "rightMargin"];
        requiredLayer = "overlay";
        break;
      case "pageNumber":
        allowedRegions = marginRegions;
        requiredLayer = "overlay";
        artifactOnly = true;
        break;
      case "decoration":
        allowedRegions = ["page", "content", ...marginRegions];
        requiredLayer = undefined;
        artifactOnly = true;
        break;
    }
    if (!allowedRegions.includes(wrapper.region)) {
      this.add(
        CODE.pageTarget,
        `${path}/region`,
        `Region ${wrapper.region} is not allowed for page-placement purpose ${wrapper.purpose}.`,
      );
    }
    if (requiredLayer !== undefined && wrapper.layer !== requiredLayer) {
      this.add(
        CODE.pageTarget,
        `${path}/layer`,
        `Page-placement purpose ${wrapper.purpose} requires layer ${requiredLayer}.`,
      );
    }
    if (artifactOnly && wrapper.semantic.mode !== "artifact") {
      this.add(
        CODE.pageTarget,
        `${path}/semantic/mode`,
        `Page-placement purpose ${wrapper.purpose} requires artifact semantics.`,
      );
    }
    if (
      wrapper.semantic.mode === "content" &&
      this.staticSinglePageTarget(wrapper.target) === undefined
    ) {
      this.add(
        CODE.pageTarget,
        `${path}/target`,
        "Content-semantic page placements must target exactly one page.",
      );
    }
  }

  private knownFinalPageCount(): number | undefined {
    const requirement = this.document.page.finalPageCountRequirement;
    if (requirement === undefined) return undefined;
    if ("exact" in requirement) return requirement.exact;
    return requirement.minimum !== undefined && requirement.minimum === requirement.maximum
      ? requirement.minimum
      : undefined;
  }

  private staticSinglePageTarget(
    target: PageLevelWrapper["target"],
  ): StaticSinglePageTarget | undefined {
    switch (target.mode) {
      case "first":
        return 1;
      case "last":
        return this.knownFinalPageCount() ?? "last";
      case "range":
        return target.start === target.end ? target.start : undefined;
      case "pages":
        return target.pages.length === 1 ? target.pages[0] as number : undefined;
      default:
        return undefined;
    }
  }

  private validatePageContentOrder(): void {
    const priorsByOrder = new Map<
      string,
      { readonly path: string; readonly target: StaticSinglePageTarget }[]
    >();
    for (const [index, wrapper] of (this.document.pageElements ?? []).entries()) {
      if (wrapper.semantic.mode !== "content") continue;
      const target = this.staticSinglePageTarget(wrapper.target);
      if (target === undefined) continue;
      const path = `/pageElements/${index}/semantic`;
      const key = `${wrapper.semantic.readingOrder}\u0000${wrapper.semantic.order}`;
      const priors = priorsByOrder.get(key) ?? [];
      const prior = priors.find((candidate) => candidate.target === target);
      if (prior !== undefined) {
        this.add(
          CODE.pageTarget,
          path,
          `Content reading order duplicates the overlapping placement at ${prior.path}.`,
        );
      }
      priors.push({ path, target });
      priorsByOrder.set(key, priors);
    }
  }

  private validateContract(contract: FieldContract, path: string): ContractInfo {
    const groups = new Map<string, string>();
    const groupRuleRefs: { ruleId: string; path: string }[] = [];
    for (let index = 0; index < (contract.groups?.length ?? 0); index++) {
      const group = contract.groups?.[index] as NonNullable<FieldContract["groups"]>[number];
      const groupPath = `${path}/groups/${index}`;
      const prior = groups.get(group.id);
      if (prior !== undefined) {
        this.add(CODE.contract, `${groupPath}/id`, `Field group id "${group.id}" duplicates ${prior}.`);
      } else {
        groups.set(group.id, `${groupPath}/id`);
      }
      if (group.conditionalRuleId !== undefined) {
        groupRuleRefs.push({ ruleId: group.conditionalRuleId, path: `${groupPath}/conditionalRuleId` });
      }
    }

    const allFieldIds = new Map<string, string>();
    const topFields = new Map<string, FieldRecord>();
    for (let index = 0; index < contract.fields.length; index++) {
      const field = contract.fields[index] as FieldDefinition;
      const fieldPath = `${path}/fields/${index}`;
      this.validateFieldDefinition(field, fieldPath, groups, allFieldIds);
      if (!topFields.has(field.id)) topFields.set(field.id, { definition: field, path: fieldPath });
    }
    return { contract, path, fields: topFields, groupRuleRefs };
  }

  private validateFieldDefinition(
    field: FieldDefinition,
    path: string,
    groups: ReadonlyMap<string, string>,
    allFieldIds: Map<string, string>,
  ): void {
    const prior = allFieldIds.get(field.id);
    if (prior !== undefined) {
      this.add(CODE.contract, `${path}/id`, `Field id "${field.id}" duplicates ${prior}.`);
    } else {
      allFieldIds.set(field.id, `${path}/id`);
    }
    if (field.groupId !== undefined && !groups.has(field.groupId)) {
      this.add(CODE.contract, `${path}/groupId`, `Field group "${field.groupId}" does not exist in this contract.`);
    }
    if (field.semanticRole !== undefined) {
      const expected = field.semanticRole === "publicationDate"
        ? field.type === "date"
        : field.type === "text" || field.type === "choice";
      if (!expected) {
        this.add(CODE.contract, `${path}/semanticRole`, `Semantic role ${field.semanticRole} is incompatible with field type ${field.type}.`);
      }
      const rolePrior = this.semanticRoles.get(field.semanticRole);
      if (rolePrior !== undefined) {
        this.add(CODE.contract, `${path}/semanticRole`, `Semantic role ${field.semanticRole} is already declared at ${rolePrior}.`);
      } else {
        this.semanticRoles.set(field.semanticRole, `${path}/semanticRole`);
      }
    }
    if (
      field.profileKey !== undefined &&
      !churchProfileKeyAcceptsFieldType(field.profileKey, field.type)
    ) {
      this.add(
        CODE.contract,
        `${path}/profileKey`,
        "Church Profile value is incompatible with this field type.",
      );
    }
    const weeklyBehavior = field.weeklyBehavior;
    if (weeklyBehavior?.derivation !== undefined && field.type !== "date") {
      this.add(CODE.contract, `${path}/weeklyBehavior/derivation`, "Date derivation is legal only on date fields.");
    }
    if (
      weeklyBehavior?.derivation !== undefined &&
      weeklyBehavior.rolloverPolicy !== "deriveConfirm"
    ) {
      this.add(
        CODE.contract,
        `${path}/weeklyBehavior/derivation`,
        "Date derivation is legal only with the deriveConfirm rollover policy.",
      );
    }
    if (weeklyBehavior?.rolloverPolicy === "deriveConfirm" && weeklyBehavior.derivation === undefined) {
      this.add(
        CODE.contract,
        `${path}/weeklyBehavior/derivation`,
        "deriveConfirm fields require a date derivation.",
      );
    }
    if (
      field.semanticRole === "publicationDate" &&
      weeklyBehavior?.rolloverPolicy !== "clear" &&
      weeklyBehavior?.rolloverPolicy !== "deriveConfirm"
    ) {
      this.add(CODE.contract, `${path}/weeklyBehavior/rolloverPolicy`, "Publication-date fields must clear or derive-and-confirm on rollover.");
    }

    const constraints = field.constraints;
    if (
      constraints?.minLength !== undefined &&
      constraints.maxLength !== undefined &&
      constraints.minLength > constraints.maxLength
    ) {
      this.add(CODE.contract, `${path}/constraints`, "minLength must not exceed maxLength.");
    }
    if (
      constraints?.minimum !== undefined &&
      constraints.maximum !== undefined &&
      constraints.minimum > constraints.maximum
    ) {
      this.add(CODE.contract, `${path}/constraints`, "minimum must not exceed maximum.");
    }
    if (
      constraints?.minItems !== undefined &&
      constraints.maxItems !== undefined &&
      constraints.minItems > constraints.maxItems
    ) {
      this.add(CODE.contract, `${path}/constraints`, "minItems must not exceed maxItems.");
    }
    if (constraints?.choices !== undefined) {
      const choiceIds = new Map<string, string>();
      for (let index = 0; index < constraints.choices.length; index++) {
        const choice = constraints.choices[index] as NonNullable<typeof constraints.choices>[number];
        const choicePath = `${path}/constraints/choices/${index}/id`;
        const choicePrior = choiceIds.get(choice.id);
        if (choicePrior !== undefined) {
          this.add(CODE.contract, choicePath, `Choice id "${choice.id}" duplicates ${choicePrior}.`);
        } else {
          choiceIds.set(choice.id, choicePath);
        }
      }
    }
    if (
      constraints?.pattern !== undefined &&
      !isSafeFieldPattern(constraints.pattern)
    ) {
      this.add(
        CODE.contract,
        `${path}/constraints/pattern`,
        "Pattern uses syntax outside the bounded linear-time v1 subset.",
      );
    }

    if (field.type === "array") {
      if (field.itemField === undefined) {
        this.add(CODE.contract, `${path}/itemField`, "Array fields require an itemField definition.");
      } else {
        this.validateFieldDefinition(field.itemField, `${path}/itemField`, groups, allFieldIds);
      }
    } else if (field.itemField !== undefined) {
      this.add(CODE.contract, `${path}/itemField`, "itemField is legal only for array fields.");
    }
    if (field.type === "object") {
      if (field.childFields === undefined) {
        this.add(CODE.contract, `${path}/childFields`, "Object fields require childFields definitions.");
      } else {
        for (let index = 0; index < field.childFields.length; index++) {
          this.validateFieldDefinition(
            field.childFields[index] as FieldDefinition,
            `${path}/childFields/${index}`,
            groups,
            allFieldIds,
          );
        }
      }
    } else if (field.childFields !== undefined) {
      this.add(CODE.contract, `${path}/childFields`, "childFields is legal only for object fields.");
    }

    if (field.default !== undefined) this.validateFieldValue(field, field.default, `${path}/default`);
    for (let index = 0; index < (field.examples?.length ?? 0); index++) {
      this.validateFieldValue(field, field.examples?.[index], `${path}/examples/${index}`);
    }
  }

  private validateFieldValue(field: FieldDefinition, value: unknown, path: string): void {
    if (value === null) {
      if (field.nullable !== true) this.add(CODE.fieldValue, path, `Field ${field.id} is not nullable.`);
      return;
    }
    let typeValid = true;
    switch (field.type) {
      case "text":
        typeValid = typeof value === "string";
        break;
      case "richText":
        typeValid = isRichTextDocument(value);
        break;
      case "date":
        typeValid = typeof value === "string" && isIsoDate(value);
        break;
      case "number":
        typeValid = typeof value === "number" && Number.isFinite(value);
        break;
      case "boolean":
        typeValid = typeof value === "boolean";
        break;
      case "choice":
        typeValid = typeof value === "string";
        if (
          typeValid &&
          !(field.constraints?.choices?.some((choice) => choice.id === value) ?? false)
        ) {
          this.add(CODE.fieldValue, path, `Choice value "${String(value)}" is not declared by field ${field.id}.`);
        }
        break;
      case "assetRef":
        typeValid = typeof value === "string" && ASSET_REF_RE.test(value);
        break;
      case "array":
        if (Array.isArray(value)) {
          if (field.itemField !== undefined) {
            for (const [index, item] of value.entries()) {
              this.validateFieldValue(field.itemField, item, `${path}/${index}`);
            }
          }
        } else {
          typeValid = false;
        }
        break;
      case "object":
        if (isPlainObject(value) && field.childFields !== undefined) {
          const children = new Map(field.childFields.map((child) => [child.id, child]));
          for (const key of Object.keys(value)) {
            const child = children.get(key);
            if (child === undefined) {
              this.add(CODE.fieldValue, `${path}/${escapePointer(key)}`, `Object field ${field.id} has undeclared child "${key}".`);
            } else {
              this.validateFieldValue(child, value[key], `${path}/${escapePointer(key)}`);
            }
          }
          for (const child of field.childFields) {
            if (child.required && child.default === undefined && !Object.hasOwn(value, child.id)) {
              this.add(CODE.fieldValue, path, `Object field ${field.id} is missing required child "${child.id}".`);
            }
          }
        } else if (!isPlainObject(value)) {
          typeValid = false;
        }
        break;
    }
    if (!typeValid) {
      this.add(CODE.fieldValue, path, `Value does not match field ${field.id} type ${field.type}.`);
      return;
    }

    const constraints = field.constraints;
    if (typeof value === "string") {
      const length = Array.from(value).length;
      if (constraints?.minLength !== undefined && length < constraints.minLength) {
        this.add(CODE.fieldValue, path, `String is shorter than minLength ${constraints.minLength}.`);
      }
      if (constraints?.maxLength !== undefined && length > constraints.maxLength) {
        this.add(CODE.fieldValue, path, `String is longer than maxLength ${constraints.maxLength}.`);
      }
      if (
        constraints?.pattern !== undefined &&
        isSafeFieldPattern(constraints.pattern) &&
        !matchesSafeFieldPattern(value, constraints.pattern)
      ) {
        this.add(CODE.fieldValue, path, "String does not match the field pattern.");
      }
    }
    if (typeof value === "number") {
      if (constraints?.minimum !== undefined && value < constraints.minimum) {
        this.add(CODE.fieldValue, path, `Number is below minimum ${constraints.minimum}.`);
      }
      if (constraints?.maximum !== undefined && value > constraints.maximum) {
        this.add(CODE.fieldValue, path, `Number is above maximum ${constraints.maximum}.`);
      }
    }
    if (Array.isArray(value)) {
      if (constraints?.minItems !== undefined && value.length < constraints.minItems) {
        this.add(CODE.fieldValue, path, `Array has fewer than minItems ${constraints.minItems}.`);
      }
      if (constraints?.maxItems !== undefined && value.length > constraints.maxItems) {
        this.add(CODE.fieldValue, path, `Array has more than maxItems ${constraints.maxItems}.`);
      }
    }
  }

  private addValueStore(
    values: FieldValues,
    path: string,
    contract: ContractInfo | undefined,
    ruleScopeKey: string | undefined,
    requireRepeatItemIds: boolean,
  ): void {
    if (contract === undefined) {
      this.add(CODE.fieldValue, path, "Field values require a corresponding field contract.");
      return;
    }
    const info: ValueStoreInfo = {
      values,
      path,
      contract,
      ...(ruleScopeKey === undefined ? {} : { ruleScopeKey }),
      requireRepeatItemIds,
    };
    this.valueStores.push(info);
    if (ruleScopeKey !== undefined) {
      const stores = this.valueStoresByRuleScope.get(ruleScopeKey) ?? [];
      stores.push(info);
      this.valueStoresByRuleScope.set(ruleScopeKey, stores);
    }
    for (const [fieldId, entry] of Object.entries(values)) {
      const entryPath = `${path}/${escapePointer(fieldId)}`;
      const field = contract.fields.get(fieldId);
      if (field === undefined) {
        this.add(CODE.fieldValue, entryPath, `Stored field id "${fieldId}" is not declared by this contract.`);
        continue;
      }
      this.validateFieldValue(field.definition, entry.value, `${entryPath}/value`);
      this.validateItemIds(field.definition, entry, entryPath);
    }
  }

  private validateItemIds(field: FieldDefinition, entry: FieldValueEntry, path: string): void {
    if (entry.itemIds === undefined) return;
    if (field.type !== "array" || !Array.isArray(entry.value)) {
      this.add(CODE.fieldValue, `${path}/itemIds`, "itemIds is legal only for array-valued fields.");
      return;
    }
    if (entry.itemIds.length !== entry.value.length) {
      this.add(CODE.fieldValue, `${path}/itemIds`, "itemIds length must equal the stored array length.");
    }
    const seen = new Set<string>();
    for (let index = 0; index < entry.itemIds.length; index++) {
      const id = entry.itemIds[index] as string;
      if (seen.has(id)) {
        this.add(CODE.fieldValue, `${path}/itemIds/${index}`, `Repeat item id "${id}" is duplicated in this array.`);
      }
      seen.add(id);
    }
  }

  private validateBinding(
    binding: Binding,
    path: string,
    element: NativeElement,
    localContract: ContractInfo | undefined,
  ): void {
    this.registerBindingId(binding.id, `${path}/id`);
    const contract = binding.scope === "document" ? this.documentContract : localContract;
    let field: FieldRecord | undefined;
    if (contract === undefined) {
      this.add(CODE.binding, `${path}/fieldId`, `Binding scope ${binding.scope} has no field contract.`);
    } else {
      field = contract.fields.get(binding.fieldId);
    }
    if (contract !== undefined && field === undefined) {
      this.add(CODE.binding, `${path}/fieldId`, `Binding field "${binding.fieldId}" is not declared in its scope.`);
    }

    const target = this.bindingTargetInfo(element, binding.target);
    if (target === undefined) {
      this.add(CODE.binding, `${path}/target`, `Binding target "${binding.target}" is not an allowlisted content-bearing data leaf for ${element.type}.`);
    } else if (field !== undefined && !target.acceptedTypes.includes(field.definition.type)) {
      this.add(
        CODE.binding,
        `${path}/target`,
        `Binding field type ${field.definition.type} is incompatible with target "${binding.target}".`,
      );
    }
    if (field !== undefined && binding.fallback !== undefined) {
      this.validateFieldValue(field.definition, binding.fallback, `${path}/fallback`);
    }
  }

  private validateRequiredLiteralBindings(
    element: NativeElement,
    path: string,
    localContract: ContractInfo | undefined,
  ): void {
    const hasOneValidBinding = (...targets: readonly string[]): boolean => {
      if (element.type === "customInstance") return false;
      const candidates = (element.bindings ?? []).filter((binding) =>
        targets.includes(binding.target));
      if (candidates.length !== 1) return false;
      const binding = candidates[0] as Binding;
      const contract = binding.scope === "document" ? this.documentContract : localContract;
      const field = contract?.fields.get(binding.fieldId)?.definition;
      const target = this.bindingTargetInfo(element, binding.target);
      return field !== undefined && target?.acceptedTypes.includes(field.type) === true;
    };
    const missing = (literalPath: string, ...targets: readonly string[]): void => {
      if (!hasOneValidBinding(...targets)) {
        this.add(
          CODE.binding,
          `${path}${literalPath}`,
          `Required content at "${literalPath}" needs a matching binding when its literal is omitted.`,
        );
      }
    };

    if (element.type === "text") {
      const content = element.data.content;
      if (content === undefined) missing("/data/content", "/data/content");
      else if (content.kind === "plain" && content.text === undefined) {
        missing("/data/content/text", "/data/content", "/data/content/text");
      } else if (content.kind === "richText" && content.document === undefined) {
        missing("/data/content/document", "/data/content", "/data/content/document");
      }
      return;
    }
    if (element.type === "image") {
      if (element.data.assetRef === undefined) missing("/data/assetRef", "/data/assetRef");
      if (element.data.focalPoint?.x === undefined && element.data.focalPoint !== undefined) {
        missing("/data/focalPoint/x", "/data/focalPoint/x");
      }
      if (element.data.focalPoint?.y === undefined && element.data.focalPoint !== undefined) {
        missing("/data/focalPoint/y", "/data/focalPoint/y");
      }
      return;
    }
    if (element.type === "date" && element.data.value === undefined) {
      missing("/data/value", "/data/value");
    }
    if (element.type === "music" && element.data.title === undefined) {
      missing("/data/title", "/data/title");
    }
  }

  private registerBindingId(id: string, path: string): void {
    const prior = this.bindingIds.get(id);
    if (prior !== undefined) {
      this.add(CODE.binding, path, `Binding id "${id}" duplicates ${prior}.`);
    } else {
      this.bindingIds.set(id, path);
    }
  }

  private bindingTargetInfo(
    element: NativeElement,
    pointer: string,
  ): { readonly acceptedTypes: readonly FieldDefinition["type"][] } | undefined {
    const segments = decodePointer(pointer);
    if (segments === undefined || segments[0] !== "data" || segments.length < 2) return undefined;
    const joined = `/${segments.join("/")}`;
    switch (element.type) {
      case "text": {
        if (joined === "/data/content") {
          return { acceptedTypes: ["text", "richText"] };
        }
        if (joined === "/data/content/text" && element.data.content?.kind === "plain") {
          return { acceptedTypes: ["text", "choice"] };
        }
        if (joined === "/data/content/document" && element.data.content?.kind === "richText") {
          return { acceptedTypes: ["richText"] };
        }
        if (
          segments.length >= 5 &&
          segments[1] === "content" &&
          segments[2] === "document" &&
          segments.at(-1) === "text"
        ) {
          const parent = readPointer(element, segments.slice(0, -1));
          if (isPlainObject(parent) && parent["type"] === "text") {
            return { acceptedTypes: ["text", "choice"] };
          }
        }
        return undefined;
      }
      case "image":
        if (joined === "/data/assetRef") return { acceptedTypes: ["assetRef"] };
        if (joined === "/data/alt") return { acceptedTypes: ["text"] };
        if (joined === "/data/decorative") return { acceptedTypes: ["boolean"] };
        if (joined === "/data/focalPoint/x" || joined === "/data/focalPoint/y") {
          return { acceptedTypes: ["number"] };
        }
        return undefined;
      case "date":
        if (joined === "/data/value") return { acceptedTypes: ["date"] };
        if (["/data/format", "/data/locale", "/data/prefix", "/data/suffix"].includes(joined)) {
          return { acceptedTypes: ["text", "choice"] };
        }
        return undefined;
      case "music":
        if (joined === "/data/title") return { acceptedTypes: ["text"] };
        if (["/data/number", "/data/instructions", "/data/source"].includes(joined)) {
          return { acceptedTypes: ["text", "choice"] };
        }
        if (joined === "/data/richContent") return { acceptedTypes: ["richText"] };
        return undefined;
      case "rightsAttribution":
        if (["/data/heading", "/data/introText"].includes(joined)) {
          return { acceptedTypes: ["text"] };
        }
        if (joined === "/data/includePublicDomainLines") {
          return { acceptedTypes: ["boolean"] };
        }
        return undefined;
      default:
        return undefined;
    }
  }

  private validateCustomReferencesAndCycles(): void {
    const graph = new Map<number, { target: number; path: string }[]>();
    for (const use of this.customUses) {
      const target = this.definitionsById.get(use.definitionId);
      if (target === undefined) {
        this.add(CODE.customReference, `${use.path}/definitionId`, `Custom definition "${use.definitionId}" does not exist.`);
        continue;
      }
      if (!Number.isSafeInteger(use.definitionVersion) || (use.definitionVersion as number) < 1) {
        this.add(CODE.customPin, `${use.path}/definitionVersion`, "Custom instance lacks a positive pinned definition revision.");
      } else if (use.definitionVersion !== target.definition.definitionVersion) {
        this.add(CODE.customPin, `${use.path}/definitionVersion`, `Pinned revision for custom definition "${use.definitionId}" does not match.`);
      }
      if (typeof use.definitionHash !== "string") {
        this.add(CODE.customPin, `${use.path}/definitionHash`, "Custom instance lacks a pinned definition hash.");
      } else if (use.definitionHash !== target.definition.definitionHash) {
        this.add(CODE.customPin, `${use.path}/definitionHash`, `Pinned hash for custom definition "${use.definitionId}" does not match.`);
      }
      if (!use.scopeKey.startsWith("definition:")) continue;
      const source = Number(use.scopeKey.slice("definition:".length));
      const edges = graph.get(source) ?? [];
      edges.push({ target: target.index, path: `${use.path}/definitionId` });
      graph.set(source, edges);
    }
    for (const edges of graph.values()) {
      edges.sort((a, b) => a.target - b.target || compareText(a.path, b.path));
    }

    const state = new Map<number, 0 | 1 | 2>();
    const reported = new Set<string>();
    const visit = (index: number): void => {
      state.set(index, 1);
      for (const edge of graph.get(index) ?? []) {
        const targetState = state.get(edge.target) ?? 0;
        if (targetState === 0) visit(edge.target);
        else if (targetState === 1 && !reported.has(edge.path)) {
          reported.add(edge.path);
          this.add(CODE.customCycle, edge.path, "Custom-definition dependency graph contains a cycle.");
        }
      }
      state.set(index, 2);
    };
    for (let index = 0; index < (this.document.customElementDefinitions?.length ?? 0); index++) {
      if ((state.get(index) ?? 0) === 0) visit(index);
    }
  }

  private validateRules(): void {
    const contexts: RuleContext[] = [];
    if (this.document.contentRules !== undefined) {
      contexts.push({
        scopeKey: "document",
        path: "/contentRules",
        rules: this.document.contentRules,
        contract: this.documentContract,
        valueStores: this.valueStoresByRuleScope.get("document") ?? [],
      });
    }
    for (let index = 0; index < (this.document.customElementDefinitions?.length ?? 0); index++) {
      const definition = this.document.customElementDefinitions?.[index] as CustomElementDefinition;
      if (definition.contentRules === undefined) continue;
      const scopeKey = `definition:${index}`;
      contexts.push({
        scopeKey,
        path: `/customElementDefinitions/${index}/contentRules`,
        rules: definition.contentRules,
        contract: this.definitionContracts.get(index),
        valueStores: this.valueStoresByRuleScope.get(scopeKey) ?? [],
      });
    }

    const allUses: RuleUse[] = [];
    const rulesById = new Map<string, RuleUse>();
    for (const context of contexts) {
      for (let index = 0; index < context.rules.length; index++) {
        const use: RuleUse = {
          rule: context.rules[index] as ContentRule,
          path: `${context.path}/${index}`,
          context,
        };
        allUses.push(use);
        const prior = rulesById.get(use.rule.id);
        if (prior !== undefined) {
          this.add(CODE.rule, `${use.path}/id`, `Rule id "${use.rule.id}" duplicates ${prior.path}/id.`);
        } else {
          rulesById.set(use.rule.id, use);
        }
      }
    }

    const repeats: RepeatUse[] = [];
    const conditionals: ConditionalUse[] = [];
    const repeatTargets = new Map<string, string>();
    const conditionalTargets = new Map<string, string>();
    const emptyStates: EmptyStateUse[] = [];

    for (const use of allUses) {
      if (use.rule.kind === "repeat") {
        const scopeElements = this.elementsByScope.get(use.context.scopeKey);
        const prototype = scopeElements?.get(use.rule.prototypeNodeId);
        const field = use.context.contract?.fields.get(use.rule.fieldId);
        const repeat: RepeatUse = {
          ...use,
          rule: use.rule,
          ...(prototype === undefined ? {} : { prototype }),
          ...(field === undefined ? {} : { field }),
        };
        repeats.push(repeat);
        const targetKey = `${use.context.scopeKey}\u0000${use.rule.prototypeNodeId}`;
        const targetPrior = repeatTargets.get(targetKey);
        if (targetPrior !== undefined) {
          this.add(CODE.rule, `${use.path}/prototypeNodeId`, `Repeat prototype is already controlled at ${targetPrior}.`);
        } else {
          repeatTargets.set(targetKey, `${use.path}/prototypeNodeId`);
        }
        if (prototype === undefined) {
          this.add(CODE.rule, `${use.path}/prototypeNodeId`, `Repeat prototype "${use.rule.prototypeNodeId}" is not an element in this rule scope.`);
        }
        if (field === undefined) {
          this.add(CODE.rule, `${use.path}/fieldId`, `Repeat field "${use.rule.fieldId}" is not declared in this rule scope.`);
        } else if (field.definition.type !== "array" || field.definition.itemField === undefined) {
          this.add(CODE.rule, `${use.path}/fieldId`, "Repeat rules require an array field with an itemField definition.");
        } else {
          const constraints = field.definition.constraints;
          if (constraints?.maxItems !== undefined && use.rule.maxItems > constraints.maxItems) {
            this.add(CODE.rule, `${use.path}/maxItems`, `Rule maxItems ${use.rule.maxItems} exceeds field maximum ${constraints.maxItems}.`);
          }
          if (constraints?.minItems !== undefined && constraints.minItems > use.rule.maxItems) {
            this.add(CODE.rule, `${use.path}/maxItems`, `Rule maxItems ${use.rule.maxItems} cannot satisfy field minimum ${constraints.minItems}.`);
          }
        }
        this.validateRepeatValues(repeat);
        this.validateItemBindings(repeat);

        if (use.rule.emptyState.mode === "show") {
          const node = scopeElements?.get(use.rule.emptyState.nodeId);
          const emptyPath = `${use.path}/emptyState/nodeId`;
          if (node === undefined) {
            this.add(CODE.rule, emptyPath, `Repeat empty-state node "${use.rule.emptyState.nodeId}" does not exist in this rule scope.`);
          } else {
            emptyStates.push({ repeat, node, path: emptyPath });
            if (prototype !== undefined && node.collectionPath !== prototype.collectionPath) {
              this.add(CODE.rule, emptyPath, "Repeat empty-state node must be a static sibling of its prototype.");
            }
          }
        }
      } else {
        const target = this.elementsByScope.get(use.context.scopeKey)?.get(use.rule.targetNodeId);
        const conditional: ConditionalUse = {
          ...use,
          rule: use.rule,
          ...(target === undefined ? {} : { target }),
        };
        conditionals.push(conditional);
        const targetKey = `${use.context.scopeKey}\u0000${use.rule.targetNodeId}`;
        const targetPrior = conditionalTargets.get(targetKey);
        if (targetPrior !== undefined) {
          this.add(CODE.rule, `${use.path}/targetNodeId`, `Conditional target is already controlled at ${targetPrior}.`);
        } else {
          conditionalTargets.set(targetKey, `${use.path}/targetNodeId`);
        }
        if (target === undefined) {
          this.add(CODE.rule, `${use.path}/targetNodeId`, `Conditional target "${use.rule.targetNodeId}" is not an element in this rule scope.`);
        }
      }
    }

    for (const conditional of conditionals) this.validateConditionalField(conditional, repeats);

    const allDirectTargets = new Set([...repeatTargets.keys(), ...conditionalTargets.keys()]);
    for (const empty of emptyStates) {
      const key = `${empty.repeat.context.scopeKey}\u0000${empty.node.id}`;
      if (allDirectTargets.has(key)) {
        this.add(CODE.rule, empty.path, "Repeat empty-state node cannot be another conditional target or repeat prototype.");
      }
    }

    this.validateGroupRuleReferences(contexts, rulesById);
    this.validateRuleGraph(repeats, conditionals, emptyStates);
  }

  private validateRepeatValues(repeat: RepeatUse): void {
    for (const store of repeat.context.valueStores) {
      const entry = store.values[repeat.rule.fieldId];
      if (entry === undefined || !Array.isArray(entry.value)) continue;
      if (entry.value.length > repeat.rule.maxItems) {
        this.add(CODE.rule, `${store.path}/${escapePointer(repeat.rule.fieldId)}/value`, `Stored repeat array length ${entry.value.length} exceeds rule maxItems ${repeat.rule.maxItems}.`);
      }
      if (store.requireRepeatItemIds && entry.itemIds === undefined) {
        this.add(CODE.fieldValue, `${store.path}/${escapePointer(repeat.rule.fieldId)}/itemIds`, "Bulletin repeat arrays require stable itemIds.");
      }
    }
  }

  private validateItemBindings(repeat: RepeatUse): void {
    for (let index = 0; index < (repeat.rule.itemBindings?.length ?? 0); index++) {
      const binding = repeat.rule.itemBindings?.[index] as NonNullable<RepeatRule["itemBindings"]>[number];
      const path = `${repeat.path}/itemBindings/${index}`;
      this.registerBindingId(binding.id, `${path}/id`);
      const target = this.elementsByScope.get(repeat.context.scopeKey)?.get(binding.targetNodeId);
      let targetInfo: ReturnType<DocumentSemanticValidator["bindingTargetInfo"]>;
      if (
        repeat.prototype === undefined ||
        target === undefined ||
        !this.isDescendantOrSelf(repeat.prototype, target)
      ) {
        this.add(CODE.binding, `${path}/targetNodeId`, "Item-binding target must be the repeat prototype or one of its descendants.");
      } else {
        targetInfo = this.bindingTargetInfo(target.element as NativeElement, binding.target);
        if (targetInfo === undefined) {
          this.add(CODE.binding, `${path}/target`, `Item-binding target "${binding.target}" is not an allowlisted content leaf.`);
        }
      }

      const repeatItem = repeat.field?.definition.itemField;
      const itemField = repeatItem === undefined
        ? undefined
        : this.resolveItemField(repeatItem, binding.itemPath);
      if (repeatItem !== undefined && itemField === undefined) {
        this.add(CODE.binding, `${path}/itemPath`, `Item path "${binding.itemPath}" does not resolve in the repeat item schema.`);
      } else if (
        itemField !== undefined &&
        targetInfo !== undefined &&
        !targetInfo.acceptedTypes.includes(itemField.type)
      ) {
        this.add(
          CODE.binding,
          `${path}/target`,
          `Item field type ${itemField.type} is incompatible with target "${binding.target}".`,
        );
      }
      if (itemField !== undefined && binding.fallback !== undefined) {
        this.validateFieldValue(itemField, binding.fallback, `${path}/fallback`);
      }
    }
  }

  private validateConditionalField(conditional: ConditionalUse, repeats: readonly RepeatUse[]): void {
    let field: FieldDefinition | undefined;
    if (conditional.rule.scope === "document") {
      field = conditional.context.contract?.fields.get(conditional.rule.fieldId)?.definition;
      if (field === undefined) {
        this.add(CODE.rule, `${conditional.path}/fieldId`, `Conditional field "${conditional.rule.fieldId}" is not declared in this rule scope.`);
        return;
      }
    } else {
      const containing = repeats
        .filter(
          (repeat) =>
            repeat.context.scopeKey === conditional.context.scopeKey &&
            repeat.prototype !== undefined &&
            conditional.target !== undefined &&
            this.isDescendantOrSelf(repeat.prototype, conditional.target),
        )
        .sort((a, b) => (b.prototype?.path.length ?? 0) - (a.prototype?.path.length ?? 0))[0];
      const itemField = containing?.field?.definition.itemField;
      if (itemField === undefined) {
        this.add(CODE.rule, `${conditional.path}/scope`, "Item-scoped conditional target is not inside a valid repeat prototype.");
        return;
      }
      field = conditional.rule.fieldId.startsWith("/")
        ? this.resolveItemField(itemField, conditional.rule.fieldId)
        : this.resolveNamedItemField(itemField, conditional.rule.fieldId);
      if (field === undefined) {
        this.add(CODE.rule, `${conditional.path}/fieldId`, `Item controller "${conditional.rule.fieldId}" does not resolve in the repeat item schema.`);
        return;
      }
    }
    const condition = conditional.rule.condition;
    const compatible = condition.kind === "booleanEquals"
      ? field.type === "boolean"
      : field.type === "choice";
    if (!compatible) {
      this.add(CODE.rule, `${conditional.path}/condition`, `Condition ${condition.kind} is incompatible with field type ${field.type}.`);
    } else if (
      condition.kind !== "booleanEquals" &&
      !(field.constraints?.choices?.some(
        (choice) => choice.id === condition.choiceId,
      ) ?? false)
    ) {
      this.add(
        CODE.rule,
        `${conditional.path}/condition/choiceId`,
        `Condition choice "${condition.choiceId}" is not declared by field ${field.id}.`,
      );
    }
  }

  private resolveNamedItemField(itemField: FieldDefinition, id: string): FieldDefinition | undefined {
    if (itemField.id === id) return itemField;
    if (itemField.type !== "object") return undefined;
    return itemField.childFields?.find((field) => field.id === id);
  }

  private resolveItemField(itemField: FieldDefinition, pointer: string): FieldDefinition | undefined {
    const segments = decodePointer(pointer);
    if (segments === undefined) return undefined;
    let current: FieldDefinition | undefined = itemField;
    for (const segment of segments) {
      if (current === undefined) return undefined;
      if (current.type === "object") {
        current = current.childFields?.find((field) => field.id === segment);
      } else if (current.type === "array" && /^(0|[1-9][0-9]*)$/.test(segment)) {
        current = current.itemField;
      } else {
        return undefined;
      }
    }
    return current;
  }

  private isDescendantOrSelf(ancestor: NodeRecord, candidate: NodeRecord): boolean {
    return candidate.id === ancestor.id || candidate.ancestors.includes(ancestor.id);
  }

  private validateGroupRuleReferences(
    contexts: readonly RuleContext[],
    globalRules: ReadonlyMap<string, RuleUse>,
  ): void {
    const contextByScope = new Map(contexts.map((context) => [context.scopeKey, context]));
    const checks: { contract: ContractInfo; scopeKey?: string }[] = [];
    if (this.documentContract !== undefined) checks.push({ contract: this.documentContract, scopeKey: "document" });
    for (const [index, contract] of this.definitionContracts) {
      checks.push({ contract, scopeKey: `definition:${index}` });
    }
    for (const contract of this.localContracts) checks.push({ contract });
    for (const check of checks) {
      const context = check.scopeKey === undefined ? undefined : contextByScope.get(check.scopeKey);
      for (const reference of check.contract.groupRuleRefs) {
        const localRule = context?.rules.find((rule) => rule.id === reference.ruleId);
        if (localRule === undefined || localRule.kind !== "conditional") {
          const global = globalRules.get(reference.ruleId);
          const detail = global === undefined ? "does not exist" : "is not a conditional rule in this contract scope";
          this.add(CODE.contract, reference.path, `Group conditional rule "${reference.ruleId}" ${detail}.`);
        }
      }
    }
  }

  private validateRuleGraph(
    repeats: readonly RepeatUse[],
    conditionals: readonly ConditionalUse[],
    emptyStates: readonly EmptyStateUse[],
  ): void {
    const direct = [
      ...repeats.flatMap((use) => (use.prototype === undefined ? [] : [{ use, node: use.prototype }])),
      ...conditionals.flatMap((use) => (use.target === undefined ? [] : [{ use, node: use.target }])),
    ];
    const graph = new Map<string, Set<string>>();
    const pathByEdge = new Map<string, string>();
    const keyOf = (scope: string, id: string): string => `${scope}\u0000${id}`;
    const addEdge = (from: string, to: string, path: string): void => {
      if (from === to) return;
      const edges = graph.get(from) ?? new Set<string>();
      edges.add(to);
      graph.set(from, edges);
      pathByEdge.set(`${from}\u0001${to}`, path);
    };
    for (const outer of direct) {
      const from = keyOf(outer.use.context.scopeKey, outer.node.id);
      if (!graph.has(from)) graph.set(from, new Set());
      for (const inner of direct) {
        if (
          inner.use.context.scopeKey === outer.use.context.scopeKey &&
          inner.node.ancestors.includes(outer.node.id)
        ) {
          addEdge(from, keyOf(inner.use.context.scopeKey, inner.node.id), inner.use.path);
        }
      }
    }
    for (const empty of emptyStates) {
      if (empty.repeat.prototype === undefined) continue;
      addEdge(
        keyOf(empty.repeat.context.scopeKey, empty.repeat.prototype.id),
        keyOf(empty.repeat.context.scopeKey, empty.node.id),
        empty.path,
      );
    }

    const state = new Map<string, 0 | 1 | 2>();
    const reported = new Set<string>();
    const visit = (node: string): void => {
      state.set(node, 1);
      const edges = [...(graph.get(node) ?? [])].sort(compareText);
      for (const target of edges) {
        const targetState = state.get(target) ?? 0;
        if (targetState === 0) visit(target);
        else if (targetState === 1) {
          const edgeKey = `${node}\u0001${target}`;
          const path = pathByEdge.get(edgeKey) ?? "";
          if (!reported.has(path)) {
            reported.add(path);
            this.add(CODE.ruleCycle, path, "Content-rule target dependency graph contains a cycle.");
          }
        }
      }
      state.set(node, 2);
    };
    for (const node of [...graph.keys()].sort(compareText)) {
      if ((state.get(node) ?? 0) === 0) visit(node);
    }
  }

  private validateReviewTargets(): void {
    const fieldTargets = new Map<string, string>();
    for (let index = 0; index < (this.document.fieldReview?.length ?? 0); index++) {
      const review = this.document.fieldReview?.[index];
      if (review === undefined) continue;
      const path = `/fieldReview/${index}/target`;
      const key = review.target.scope === "document"
        ? `document\u0000${review.target.fieldId}`
        : `local\u0000${review.target.ownerNodeId}\u0000${review.target.fieldId}`;
      const prior = fieldTargets.get(key);
      if (prior !== undefined) this.add(CODE.fieldValue, path, `Field-review target duplicates ${prior}.`);
      else fieldTargets.set(key, path);
      if (review.target.scope === "document") {
        if (!this.documentContract?.fields.has(review.target.fieldId)) {
          this.add(CODE.fieldValue, path, `Field-review target field "${review.target.fieldId}" does not exist.`);
        }
      } else {
        const owner = this.firstNodeById.get(review.target.ownerNodeId);
        if (owner?.kind !== "element" || owner.scopeKey !== "document") {
          this.add(CODE.fieldValue, path, `Field-review owner "${review.target.ownerNodeId}" does not exist.`);
        } else if (!this.localContractByOwnerId.get(owner.id)?.fields.has(review.target.fieldId)) {
          this.add(
            CODE.fieldValue,
            path,
            `Field-review target field "${review.target.fieldId}" does not exist in owner "${review.target.ownerNodeId}".`,
          );
        }
      }
    }

    const contentTargets = new Map<string, string>();
    for (let index = 0; index < (this.document.contentReview?.length ?? 0); index++) {
      const review = this.document.contentReview?.[index];
      if (review === undefined) continue;
      const path = `/contentReview/${index}/target`;
      const key = review.target.scope === "document"
        ? `document\u0000${review.target.targetNodeId}`
        : `custom\u0000${review.target.ownerNodeId}\u0000${review.target.definitionNodeId}`;
      const prior = contentTargets.get(key);
      if (prior !== undefined) this.add(CODE.fieldValue, path, `Content-review target duplicates ${prior}.`);
      else contentTargets.set(key, path);
      if (review.target.scope === "document") {
        const target = this.firstNodeById.get(review.target.targetNodeId);
        if (target?.kind !== "element" || target.scopeKey !== "document") {
          this.add(CODE.fieldValue, path, `Content-review target node "${review.target.targetNodeId}" does not exist.`);
        }
      } else {
        const owner = this.firstNodeById.get(review.target.ownerNodeId);
        const ownerElement = owner?.element;
        if (owner?.scopeKey !== "document" || ownerElement?.type !== "customInstance") {
          this.add(CODE.fieldValue, path, `Custom content-review owner "${review.target.ownerNodeId}" is not a custom instance.`);
        } else {
          const definition = this.definitionsById.get(ownerElement.definitionId);
          const scope = definition === undefined
            ? undefined
            : this.elementsByScope.get(`definition:${definition.index}`);
          if (
            definition === undefined ||
            (definition.definition.id !== review.target.definitionNodeId &&
              !scope?.has(review.target.definitionNodeId))
          ) {
            this.add(CODE.fieldValue, path, `Custom content-review definition node "${review.target.definitionNodeId}" does not exist in the owner's definition.`);
          }
        }
      }
    }
  }

  private validateSemanticRoleMetadataMirrors(): void {
    const contract = this.document.fieldContract;
    if (contract === undefined) return;
    for (const role of ["publicationDate", "serviceLabel"] as const) {
      const candidates = contract.fields.filter(
        (field) => field.semanticRole === role,
      );
      // Contract validation owns duplicate/type diagnostics. Do not guess
      // which invalid declaration controls a portable metadata mirror.
      if (candidates.length !== 1) continue;
      const field = candidates[0] as FieldDefinition;
      const compatible = role === "publicationDate"
        ? field.type === "date"
        : field.type === "text" || field.type === "choice";
      if (!compatible) continue;

      const effective = resolveEffectiveField(
        {
          contract,
          ...(this.document.fieldValues === undefined
            ? {}
            : { values: this.document.fieldValues }),
        },
        field.id,
      );
      let expected: string | undefined;
      if (typeof effective.value === "string") {
        if (role === "serviceLabel" && field.type === "choice") {
          const matchingChoices = field.constraints?.choices?.filter(
            (choice) => choice.id === effective.value,
          ) ?? [];
          if (matchingChoices.length === 1) {
            expected = matchingChoices[0]?.label;
          }
        } else {
          expected = effective.value;
        }
      }
      const actual = this.document.metadata?.[role];
      if (actual !== expected) {
        this.add(
          CODE.fieldValue,
          `/metadata/${role}`,
          expected === undefined
            ? `Metadata ${role} must be absent because semantic-role field "${field.id}" has no effective stored/default value.`
            : `Metadata ${role} must mirror semantic-role field "${field.id}" as ${JSON.stringify(expected)}.`,
        );
      }
    }
  }
}

/** Validate all v1 cross-tree semantic invariants without mutating the document. */
export function validateDocumentSemantics(doc: CbbDocument): SemanticValidationResult {
  return new DocumentSemanticValidator(doc).run();
}
