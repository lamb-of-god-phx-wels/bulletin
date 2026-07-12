import { canonicalStringify, hashCanonical } from "../canonical/index.js";
import type {
  CbbDocument,
  ContentReviewTarget,
  FieldContract,
  FieldReviewTarget,
  FieldValues,
  NativeElement,
} from "../document/types.js";
import { resolveEffectiveField } from "../resolve/field.js";
import type {
  ResolvedReadinessFieldTarget,
  ResolvedReadinessFieldUse,
  ResolvedReadinessSource,
} from "../resolve/types.js";
import { fieldContractHash } from "./canonicalHashes.js";
import type {
  DocumentReadinessProjection,
  HashJsonObject,
  HashJsonValue,
  RightsAssociationReadinessProjection,
  RightsRecordReadinessProjection,
  ScriptureImportReadinessProjection,
  WeeklyReviewProjection,
} from "./types.js";
import {
  assertHashJson,
  assertNamedHashes,
  assertNonemptyString,
  assertPlainObject,
  assertSha256,
  cloneHashJson,
  compareUtf16,
  HashInputError,
} from "./validation.js";

const DEFAULT_PUBLICATION_CONTEXTS = [
  "digitalNonsalableChurchBulletin",
  "printedNonsalableChurchBulletin",
] as const;

interface ProjectionCollections {
  readonly weeklyReviews: WeeklyReviewProjection[];
  readonly rightsRecords: RightsRecordReadinessProjection[];
  readonly rightsAssociations: RightsAssociationReadinessProjection[];
  readonly scriptureImports: ScriptureImportReadinessProjection[];
}

interface ReviewFieldScope {
  readonly contract: FieldContract;
  readonly values?: FieldValues;
}

interface FieldUseCollection {
  readonly target: ResolvedReadinessFieldTarget;
  readonly bindings: HashJsonValue[];
  readonly conditionalRules: HashJsonValue[];
  readonly repeatRules: HashJsonValue[];
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  assertPlainObject(value, path);
  return value;
}

function cloneArray(value: unknown, path: string): readonly HashJsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HashInputError(path, "expected an array");
  }
  return value.map((entry, index) => cloneHashJson(entry, `${path}[${index}]`, false));
}

function normalizedPublicationContexts(value: unknown): readonly string[] {
  if (value === undefined) return [...DEFAULT_PUBLICATION_CONTEXTS];
  if (!Array.isArray(value) || value.length === 0) {
    throw new HashInputError("$document.publicationContexts", "expected a nonempty array");
  }
  const seen = new Set<string>();
  const contexts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (
      entry !== "printedNonsalableChurchBulletin" &&
      entry !== "digitalNonsalableChurchBulletin"
    ) {
      throw new HashInputError(
        `$document.publicationContexts[${index}]`,
        "unknown publication context",
      );
    }
    if (seen.has(entry)) {
      throw new HashInputError(
        `$document.publicationContexts[${index}]`,
        `duplicate publication context ${entry}`,
      );
    }
    seen.add(entry);
    contexts.push(entry);
  }
  return contexts.sort(compareUtf16);
}

function projectRightsRecord(value: unknown, path: string): HashJsonObject {
  const rights = recordAt(value, path);
  assertNonemptyString(rights["creditKey"], `${path}.creditKey`);
  assertSha256(rights["creditProjectionHash"], `${path}.creditProjectionHash`);
  assertNonemptyString(rights["component"], `${path}.component`);
  assertNonemptyString(rights["status"], `${path}.status`);
  assertNonemptyString(rights["creditRequiredWhen"], `${path}.creditRequiredWhen`);

  let publicationLicense: HashJsonValue = null;
  if (rights["publicationLicenseDisplay"] !== undefined) {
    const licensePath = `${path}.publicationLicenseDisplay`;
    const license = recordAt(rights["publicationLicenseDisplay"], licensePath);
    assertSha256(
      license["sourceDisplayRevisionHash"],
      `${licensePath}.sourceDisplayRevisionHash`,
    );
    publicationLicense = {
      sourceDisplayRevisionHash: license["sourceDisplayRevisionHash"],
      effectiveFrom:
        typeof license["effectiveFrom"] === "string" ? license["effectiveFrom"] : null,
      effectiveThrough:
        typeof license["effectiveThrough"] === "string" ? license["effectiveThrough"] : null,
    };
  }

  let usagePolicy: HashJsonValue = null;
  if (rights["usagePolicySnapshot"] !== undefined) {
    usagePolicy = cloneHashJson(
      rights["usagePolicySnapshot"],
      `${path}.usagePolicySnapshot`,
      false,
    );
    assertNamedHashes(usagePolicy, `${path}.usagePolicySnapshot`);
  }

  return {
    creditKey: rights["creditKey"],
    creditProjectionHash: rights["creditProjectionHash"],
    component: rights["component"],
    status: rights["status"],
    creditRequiredWhen: rights["creditRequiredWhen"],
    publicationLicense,
    usagePolicy,
  };
}

function projectRightsArray(
  value: unknown,
  path: string,
): RightsRecordReadinessProjection {
  if (!Array.isArray(value)) {
    throw new HashInputError(path, "expected a rights array");
  }
  return {
    path,
    records: value.map((entry, index) =>
      projectRightsRecord(entry, `${path}[${index}]`),
    ),
  };
}

function projectAssociationReview(value: unknown, path: string): HashJsonValue {
  const review = recordAt(value, path);
  assertSha256(review["reviewedSongContentHash"], `${path}.reviewedSongContentHash`);
  assertSha256(
    review["reviewedRightsProjectionHash"],
    `${path}.reviewedRightsProjectionHash`,
  );
  if (typeof review["reviewTime"] !== "string") {
    throw new HashInputError(`${path}.reviewTime`, "expected an RFC 3339 timestamp");
  }
  return {
    reviewedSongContentHash: review["reviewedSongContentHash"],
    reviewedRightsProjectionHash: review["reviewedRightsProjectionHash"],
    reviewTime: review["reviewTime"],
  };
}

function projectScriptureImport(
  scripture: Record<string, unknown>,
  path: string,
): ScriptureImportReadinessProjection | undefined {
  const snapshotValue = scripture["importSnapshot"];
  const reviewValue = scripture["importReview"];
  if (snapshotValue === undefined && reviewValue === undefined) return undefined;

  let snapshotEvidence: HashJsonValue = null;
  if (snapshotValue !== undefined) {
    const snapshotPath = `${path}.importSnapshot`;
    const snapshot = recordAt(snapshotValue, snapshotPath);
    assertNonemptyString(snapshot["sourceKind"], `${snapshotPath}.sourceKind`);
    assertNonemptyString(snapshot["structureKind"], `${snapshotPath}.structureKind`);
    assertNonemptyString(snapshot["normalizerId"], `${snapshotPath}.normalizerId`);
    assertNonemptyString(snapshot["normalizerVersion"], `${snapshotPath}.normalizerVersion`);
    assertSha256(snapshot["importedFidelityHash"], `${snapshotPath}.importedFidelityHash`);
    assertSha256(snapshot["rightsProjectionHash"], `${snapshotPath}.rightsProjectionHash`);
    snapshotEvidence = {
      sourceKind: snapshot["sourceKind"],
      structureKind: snapshot["structureKind"],
      normalizerId: snapshot["normalizerId"],
      normalizerVersion: snapshot["normalizerVersion"],
      importedFidelityHash: snapshot["importedFidelityHash"],
      rightsProjectionHash: snapshot["rightsProjectionHash"],
    };
  }

  let review: HashJsonValue = null;
  if (reviewValue !== undefined) {
    const reviewPath = `${path}.importReview`;
    const reviewRecord = recordAt(reviewValue, reviewPath);
    if (reviewRecord["disposition"] !== "changesConfirmed") {
      throw new HashInputError(`${reviewPath}.disposition`, "invalid import review disposition");
    }
    assertSha256(reviewRecord["reviewedFidelityHash"], `${reviewPath}.reviewedFidelityHash`);
    assertSha256(
      reviewRecord["reviewedRightsProjectionHash"],
      `${reviewPath}.reviewedRightsProjectionHash`,
    );
    if (typeof reviewRecord["reviewTime"] !== "string") {
      throw new HashInputError(`${reviewPath}.reviewTime`, "expected an RFC 3339 timestamp");
    }
    review = {
      disposition: "changesConfirmed",
      reviewedFidelityHash: reviewRecord["reviewedFidelityHash"],
      reviewedRightsProjectionHash: reviewRecord["reviewedRightsProjectionHash"],
      reviewTime: reviewRecord["reviewTime"],
    };
  }

  return { path, snapshotEvidence, review };
}

function collectRichTextReadiness(
  value: unknown,
  path: string,
  output: ProjectionCollections,
): void {
  const node = recordAt(value, path);
  if (node["type"] === "scripture") {
    output.rightsRecords.push(projectRightsArray(node["rights"], `${path}/rights`));
    const scripture = projectScriptureImport(node, path);
    if (scripture !== undefined) output.scriptureImports.push(scripture);
    // Every other Scripture property is either rendered content or an opaque,
    // deliberately reduced snapshot. Never key-sniff typography/source data.
    return;
  }
  if (
    node["type"] !== "bulletList" &&
    node["type"] !== "orderedList" &&
    node["type"] !== "blockquote" &&
    node["type"] !== "listItem"
  ) {
    return;
  }
  if (!Array.isArray(node["children"])) {
    throw new HashInputError(`${path}/children`, "expected a rich-text child array");
  }
  for (let index = 0; index < node["children"].length; index++) {
    collectRichTextReadiness(
      node["children"][index],
      `${path}/children/${index}`,
      output,
    );
  }
}

function collectRichTextDocumentReadiness(
  value: unknown,
  path: string,
  output: ProjectionCollections,
): void {
  const document = recordAt(value, path);
  if (!Array.isArray(document["blocks"])) {
    throw new HashInputError(`${path}/blocks`, "expected a rich-text block array");
  }
  for (let index = 0; index < document["blocks"].length; index++) {
    collectRichTextReadiness(
      document["blocks"][index],
      `${path}/blocks/${index}`,
      output,
    );
  }
}

function collectElementReadiness(
  source: ResolvedReadinessSource,
  output: ProjectionCollections,
): void {
  const { element, path } = source;
  if (element.weeklyReview !== undefined) {
    output.weeklyReviews.push({ path, expectation: element.weeklyReview });
  }

  if (element.type === "text" && element.data.content.kind === "richText") {
    collectRichTextDocumentReadiness(
      element.data.content.document,
      `${path}/data/content/document`,
      output,
    );
    return;
  }

  if (element.type !== "music") return;
  output.rightsRecords.push(
    projectRightsArray(element.data.rights, `${path}/data/rights`),
  );
  output.rightsAssociations.push({
    path: `${path}/data`,
    review: projectAssociationReview(
      element.data.rightsAssociationReview,
      `${path}/data/rightsAssociationReview`,
    ),
  });
  if (element.data.richContent !== undefined) {
    collectRichTextDocumentReadiness(
      element.data.richContent,
      `${path}/data/richContent`,
      output,
    );
  }
}

function sortByPath<T extends { readonly path: string }>(values: T[]): readonly T[] {
  values.sort((a, b) => compareUtf16(a.path, b.path));
  return values;
}

function reviewTargetKey(target: ResolvedReadinessFieldTarget): string {
  return target.scope === "document"
    ? `document\u0000${target.fieldId}`
    : `local\u0000${target.ownerNodeId}\u0000${target.fieldId}`;
}

function compareReviewTargets(
  left: ResolvedReadinessFieldTarget,
  right: ResolvedReadinessFieldTarget,
): number {
  return compareUtf16(reviewTargetKey(left), reviewTargetKey(right));
}

function normalizeReviewTarget(
  target: FieldReviewTarget,
): ResolvedReadinessFieldTarget {
  return target.scope === "document"
    ? { scope: "document", fieldId: target.fieldId }
    : {
        scope: "local",
        ownerNodeId: target.ownerNodeId,
        fieldId: target.fieldId,
      };
}

function indexLocalReviewScopes(
  document: CbbDocument,
): ReadonlyMap<string, ReviewFieldScope> {
  const definitions = new Map(
    (document.customElementDefinitions ?? []).map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const scopes = new Map<string, ReviewFieldScope>();
  const visit = (element: NativeElement): void => {
    if (element.type === "customInstance") {
      const definition = definitions.get(element.definitionId);
      if (definition !== undefined && !scopes.has(element.id)) {
        scopes.set(element.id, {
          contract: definition.fieldContract,
          ...(element.fieldValues === undefined
            ? {}
            : { values: element.fieldValues }),
        });
      }
      return;
    }
    if (element.fieldContract !== undefined && !scopes.has(element.id)) {
      scopes.set(element.id, {
        contract: element.fieldContract,
        ...(element.fieldValues === undefined ? {} : { values: element.fieldValues }),
      });
    }
    if (
      element.type === "grid" ||
      element.type === "stack" ||
      element.type === "canvas"
    ) {
      for (const child of element.children) visit(child.element);
    }
  };
  for (const element of document.elements) visit(element);
  for (const wrapper of document.pageElements ?? []) {
    visit(wrapper.element as unknown as NativeElement);
  }
  for (const definition of document.customElementDefinitions ?? []) {
    for (const element of definition.elements) visit(element);
  }
  return scopes;
}

function uniqueCanonical(values: readonly HashJsonValue[]): readonly HashJsonValue[] {
  const byCanonical = new Map<string, HashJsonValue>();
  for (const value of values) byCanonical.set(canonicalStringify(value), value);
  return [...byCanonical.entries()]
    .sort(([left], [right]) => compareUtf16(left, right))
    .map(([, value]) => value);
}

function collectFieldReviewContexts(
  document: CbbDocument,
  readinessFieldUses: readonly ResolvedReadinessFieldUse[],
): readonly HashJsonValue[] {
  const collections = new Map<string, FieldUseCollection>();
  const ensure = (
    target: ResolvedReadinessFieldTarget,
  ): FieldUseCollection => {
    const key = reviewTargetKey(target);
    let collection = collections.get(key);
    if (collection === undefined) {
      collection = { target, bindings: [], conditionalRules: [], repeatRules: [] };
      collections.set(key, collection);
    }
    return collection;
  };

  for (const review of document.fieldReview ?? []) {
    ensure(normalizeReviewTarget(review.target));
  }
  for (const use of readinessFieldUses) {
    const collection = ensure(use.target);
    if (use.kind === "binding") {
      collection.bindings.push({
        id: use.bindingId,
        ...(use.fallbackUsed === undefined
          ? {}
          : { fallbackHash: hashCanonical(use.fallbackUsed) }),
      });
    } else if (use.kind === "conditionalRule") {
      collection.conditionalRules.push({
        id: use.ruleId,
        targetNodeId: use.targetNodeId,
        activation: use.activation,
        condition: cloneHashJson(
          use.condition,
          `$readinessFieldUses.${use.ruleId}.condition`,
          false,
        ),
      });
    } else {
      collection.repeatRules.push({
        id: use.ruleId,
        prototypeNodeId: use.prototypeNodeId,
        emptyState: cloneHashJson(
          use.emptyState,
          `$readinessFieldUses.${use.ruleId}.emptyState`,
          false,
        ),
        maxItems: use.maxItems,
        nullIsEmpty: use.nullIsEmpty,
      });
    }
  }

  const localScopes = indexLocalReviewScopes(document);
  const documentScope: ReviewFieldScope | undefined =
    document.fieldContract === undefined
      ? undefined
      : {
          contract: document.fieldContract,
          ...(document.fieldValues === undefined
            ? {}
            : { values: document.fieldValues }),
        };

  return [...collections.values()]
    .sort((left, right) => compareReviewTargets(left.target, right.target))
    .map((collection) => {
      const scope = collection.target.scope === "document"
        ? documentScope
        : localScopes.get(collection.target.ownerNodeId);
      const effective = scope === undefined
        ? undefined
        : resolveEffectiveField(scope, collection.target.fieldId);
      const contract: HashJsonValue = scope === undefined
        ? null
        : {
            id: scope.contract.id,
            version: scope.contract.version,
            contractHash: fieldContractHash(scope.contract),
          };
      const effectiveValue: HashJsonValue = effective?.definition === undefined
        ? { state: "unresolvedField" }
        : effective.missing || effective.value === undefined
          ? { state: "missing" }
          : {
              state: "present",
              valueHash: hashCanonical(effective.value),
            };
      return {
        target: collection.target,
        contract,
        effectiveValue,
        activeBindings: uniqueCanonical(collection.bindings),
        activeConditionalRules: uniqueCanonical(collection.conditionalRules),
        activeRepeatRules: uniqueCanonical(collection.repeatRules),
      };
    });
}

interface ContentNodeRecord {
  readonly ancestors: readonly string[];
}

interface ContentNodeIndexes {
  readonly document: ReadonlyMap<string, ContentNodeRecord>;
  readonly definitions: ReadonlyMap<
    string,
    ReadonlyMap<string, ContentNodeRecord>
  >;
}

function indexContentNodes(document: CbbDocument): ContentNodeIndexes {
  const documentNodes = new Map<string, ContentNodeRecord>();
  const definitionNodes = new Map<string, ReadonlyMap<string, ContentNodeRecord>>();
  const visit = (
    element: NativeElement,
    ancestors: readonly string[],
    output: Map<string, ContentNodeRecord>,
  ): void => {
    if (!output.has(element.id)) output.set(element.id, { ancestors });
    if (
      element.type === "grid" ||
      element.type === "stack" ||
      element.type === "canvas"
    ) {
      for (const child of element.children) {
        visit(child.element, [...ancestors, element.id], output);
      }
    }
  };
  for (const element of document.elements) visit(element, [], documentNodes);
  for (const wrapper of document.pageElements ?? []) {
    visit(wrapper.element as unknown as NativeElement, [], documentNodes);
  }
  for (const definition of document.customElementDefinitions ?? []) {
    const nodes = new Map<string, ContentNodeRecord>();
    for (const element of definition.elements) visit(element, [], nodes);
    definitionNodes.set(definition.id, nodes);
  }
  return { document: documentNodes, definitions: definitionNodes };
}

function nodeIsControlledBy(
  nodeId: string,
  controllerNodeId: string,
  nodes: ReadonlyMap<string, ContentNodeRecord>,
): boolean {
  const node = nodes.get(nodeId);
  return (
    nodeId === controllerNodeId ||
    (node?.ancestors.includes(controllerNodeId) ?? false)
  );
}

function conditionalAppliesToContentTarget(
  target: ContentReviewTarget,
  use: Extract<ResolvedReadinessFieldUse, { readonly kind: "conditionalRule" }>,
  indexes: ContentNodeIndexes,
): boolean {
  if (use.contentScope.scope === "document") {
    const targetNodeId = target.scope === "document"
      ? target.targetNodeId
      : target.ownerNodeId;
    return nodeIsControlledBy(
      targetNodeId,
      use.targetNodeId,
      indexes.document,
    );
  }
  if (
    target.scope !== "custom" ||
    target.ownerNodeId !== use.contentScope.ownerNodeId
  ) {
    return false;
  }
  if (target.definitionNodeId === use.contentScope.definitionId) return true;
  const nodes = indexes.definitions.get(use.contentScope.definitionId);
  return nodes === undefined
    ? false
    : nodeIsControlledBy(target.definitionNodeId, use.targetNodeId, nodes);
}

function collectContentReviewContexts(
  document: CbbDocument,
  readinessFieldUses: readonly ResolvedReadinessFieldUse[],
): readonly HashJsonValue[] {
  const conditionals = readinessFieldUses.filter(
    (
      use,
    ): use is Extract<
      ResolvedReadinessFieldUse,
      { readonly kind: "conditionalRule" }
    > => use.kind === "conditionalRule",
  );
  const indexes = indexContentNodes(document);
  return (document.contentReview ?? []).map((review, index) => ({
    target: cloneHashJson(
      review.target,
      `$document.contentReview[${index}].target`,
      false,
    ),
    activeConditionalRules: uniqueCanonical(
      conditionals
        .filter((use) =>
          conditionalAppliesToContentTarget(review.target, use, indexes),
        )
        .map((use) => ({
          id: use.ruleId,
          targetNodeId: use.targetNodeId,
          controllerTarget: use.target,
          activation: use.activation,
          condition: cloneHashJson(
            use.condition,
            `$readinessFieldUses.${use.ruleId}.condition`,
            false,
          ),
        })),
    ),
  }));
}

/**
 * Select readiness-only portable state from document-owned global state and
 * resolution-produced active, binding-materialized element boundaries.
 *
 * This does not evaluate readiness. Dynamic dependency, page-count, rights,
 * and accessibility results enter through ReadinessEvidenceRecord values.
 */
export function projectDocumentReadinessState(
  document: CbbDocument,
  readinessSources: readonly ResolvedReadinessSource[],
  readinessFieldUses: readonly ResolvedReadinessFieldUse[],
): DocumentReadinessProjection {
  assertHashJson(document, "$document");
  const doc = recordAt(document, "$document");
  const metadata =
    doc["metadata"] === undefined
      ? undefined
      : recordAt(doc["metadata"], "$document.metadata");
  const page = recordAt(doc["page"], "$document.page");

  let rightsPolicy: HashJsonValue = { unknownRightsPolicy: "review" };
  if (doc["rightsPolicy"] !== undefined) {
    const policy = recordAt(doc["rightsPolicy"], "$document.rightsPolicy");
    if (
      policy["unknownRightsPolicy"] !== "review" &&
      policy["unknownRightsPolicy"] !== "block"
    ) {
      throw new HashInputError(
        "$document.rightsPolicy.unknownRightsPolicy",
        "invalid unknown-rights policy",
      );
    }
    rightsPolicy = { unknownRightsPolicy: policy["unknownRightsPolicy"] };
  }

  let bookletSafeInset: HashJsonValue = null;
  if (page["bookletPrintSetup"] !== undefined) {
    const booklet = recordAt(page["bookletPrintSetup"], "$document.page.bookletPrintSetup");
    if (booklet["safeInset"] !== undefined) {
      bookletSafeInset = cloneHashJson(
        booklet["safeInset"],
        "$document.page.bookletPrintSetup.safeInset",
        false,
      );
    }
  }

  const output: ProjectionCollections = {
    weeklyReviews: [],
    rightsRecords: [],
    rightsAssociations: [],
    scriptureImports: [],
  };
  for (let index = 0; index < readinessSources.length; index++) {
    const source = readinessSources[index] as ResolvedReadinessSource;
    assertNonemptyString(source.path, `$readinessSources[${index}].path`);
    assertHashJson(source.element, `$readinessSources[${index}].element`);
    collectElementReadiness(source, output);
  }

  const projection: DocumentReadinessProjection = {
    metadataContext: {
      publicationDate:
        typeof metadata?.["publicationDate"] === "string"
          ? metadata["publicationDate"]
          : null,
      serviceLabel:
        typeof metadata?.["serviceLabel"] === "string" ? metadata["serviceLabel"] : null,
    },
    rightsPolicy,
    publicationContexts: normalizedPublicationContexts(doc["publicationContexts"]),
    fieldReview: cloneArray(doc["fieldReview"], "$document.fieldReview"),
    fieldReviewContexts: collectFieldReviewContexts(document, readinessFieldUses),
    contentReview: cloneArray(doc["contentReview"], "$document.contentReview"),
    contentReviewContexts: collectContentReviewContexts(
      document,
      readinessFieldUses,
    ),
    pageChecks: {
      finalPageCountRequirement:
        page["finalPageCountRequirement"] === undefined
          ? null
          : cloneHashJson(
              page["finalPageCountRequirement"],
              "$document.page.finalPageCountRequirement",
              false,
            ),
      printSafeInset:
        page["printSafeInset"] === undefined
          ? null
          : cloneHashJson(page["printSafeInset"], "$document.page.printSafeInset", false),
      bookletSafeInset,
    },
    weeklyReviews: sortByPath(output.weeklyReviews),
    rightsRecords: sortByPath(output.rightsRecords),
    rightsAssociations: sortByPath(output.rightsAssociations),
    scriptureImports: sortByPath(output.scriptureImports),
  };
  assertNamedHashes(projection);
  return projection;
}
