/**
 * @cbb/core/document/parse — current parsing and explicit v1 normalization.
 *
 * `fromJson` normalizes historical document version 1 to current version 2,
 * then validates the current closed schema. Current v2 input is never repaired
 * or reclassified: missing current pin metadata therefore fails validation.
 * The v1 transform is pure and persistence remains an explicit caller action.
 */

import { hashCanonical } from "../canonical/index.js";
import type { SchemaCatalog, ValidationError } from "../schema/index.js";
import {
  finalizeCustomDefinitionRevisions,
  type CustomDefinitionRevisionSet,
} from "./customDefinitions.js";
import type {
  CbbDocument,
  CustomElementDefinition,
  NativeElement,
  PageLevelWrapper,
  Sha256HashString,
} from "./types.js";

export const DOCUMENT_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/document.schema.json";

export class DocumentValidationError extends Error {
  readonly errors: readonly ValidationError[];

  constructor(errors: readonly ValidationError[]) {
    const summary = errors
      .slice(0, 3)
      .map((error) => `[${error.instancePath}] ${error.message}`)
      .join("; ");
    super(`Document schema validation failed: ${summary}`);
    this.name = "DocumentValidationError";
    this.errors = errors;
  }
}

/** Historical input could not be upgraded without inventing or weakening pins. */
export class DocumentMigrationError extends Error {
  constructor(message: string) {
    super(`Document migration failed: ${message}`);
    this.name = "DocumentMigrationError";
  }
}

const EMPTY_SHA256 = `sha256:${"0".repeat(64)}` as Sha256HashString;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]));
}

function mapLegacyElement(
  value: unknown,
  transform: (element: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (!isRecord(value)) return value;
  let element: Record<string, unknown> = value;
  if (
    (value["type"] === "grid" || value["type"] === "stack" || value["type"] === "canvas") &&
    Array.isArray(value["children"])
  ) {
    element = {
      ...value,
      children: value["children"].map((wrapper) => isRecord(wrapper)
        ? { ...wrapper, element: mapLegacyElement(wrapper["element"], transform) }
        : wrapper),
    };
  }
  return transform(element);
}

function forEachLegacyElement(
  document: Record<string, unknown>,
  callback: (element: Record<string, unknown>, path: string) => void,
): void {
  const visit = (value: unknown, path: string): void => {
    if (!isRecord(value)) return;
    callback(value, path);
    if (
      (value["type"] === "grid" || value["type"] === "stack" || value["type"] === "canvas") &&
      Array.isArray(value["children"])
    ) {
      value["children"].forEach((wrapper, index) => {
        if (isRecord(wrapper)) visit(wrapper["element"], `${path}/children/${index}/element`);
      });
    }
  };
  if (Array.isArray(document["elements"])) {
    document["elements"].forEach((element, index) => visit(element, `/elements/${index}`));
  }
  if (Array.isArray(document["pageElements"])) {
    document["pageElements"].forEach((wrapper, index) => {
      if (isRecord(wrapper)) visit(wrapper["element"], `/pageElements/${index}/element`);
    });
  }
  if (Array.isArray(document["customElementDefinitions"])) {
    document["customElementDefinitions"].forEach((definition, definitionIndex) => {
      if (!isRecord(definition) || !Array.isArray(definition["elements"])) return;
      definition["elements"].forEach((element, elementIndex) => visit(
        element,
        `/customElementDefinitions/${definitionIndex}/elements/${elementIndex}`,
      ));
    });
  }
}

function legacyDefinitions(
  document: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const raw = document["customElementDefinitions"];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((definition) => !isRecord(definition))) {
    throw new DocumentMigrationError("customElementDefinitions is not a definition array");
  }
  return raw as readonly Record<string, unknown>[];
}

function assertLegacyPinIntegrity(
  document: Record<string, unknown>,
  definitions: readonly Record<string, unknown>[],
): void {
  const byId = new Map<string, Record<string, unknown>>();
  for (const [index, definition] of definitions.entries()) {
    if ("definitionVersion" in definition || "definitionHash" in definition) {
      throw new DocumentMigrationError(
        `v1 definition ${index} contains current-only revision metadata`,
      );
    }
    const id = definition["id"];
    if (typeof id !== "string" || id.length === 0 || byId.has(id)) {
      throw new DocumentMigrationError(`v1 definition ${index} has an invalid or duplicate id`);
    }
    byId.set(id, definition);
  }
  forEachLegacyElement(document, (element, path) => {
    if (element["type"] !== "customInstance") return;
    if ("definitionVersion" in element) {
      throw new DocumentMigrationError(`${path} contains current-only definitionVersion`);
    }
    const definitionId = element["definitionId"];
    const target = typeof definitionId === "string" ? byId.get(definitionId) : undefined;
    if (target === undefined) {
      throw new DocumentMigrationError(`${path} references a missing custom definition`);
    }
    const legacyPin = element["definitionHash"];
    if (legacyPin !== undefined && legacyPin !== hashCanonical(target)) {
      throw new DocumentMigrationError(`${path} has a mismatched legacy definition hash`);
    }
  });
}

function provisionalElement(value: unknown): unknown {
  return mapLegacyElement(value, (element) => element["type"] !== "customInstance"
    ? element
    : {
        ...element,
        definitionVersion: 1,
        definitionHash: EMPTY_SHA256,
      });
}

function migrateVersionOne(value: Record<string, unknown>): Record<string, unknown> {
  const sourceDefinitions = legacyDefinitions(value);
  assertLegacyPinIntegrity(value, sourceDefinitions);
  const cloned = cloneJson(value) as Record<string, unknown>;
  const definitions = sourceDefinitions.map((definition) => {
    const clonedDefinition = cloneJson(definition) as Record<string, unknown>;
    return {
      ...clonedDefinition,
      definitionVersion: 1,
      definitionHash: EMPTY_SHA256,
      elements: Array.isArray(clonedDefinition["elements"])
        ? clonedDefinition["elements"].map(provisionalElement)
        : clonedDefinition["elements"],
    } as unknown as CustomElementDefinition;
  });
  if (!Array.isArray(cloned["elements"])) {
    throw new DocumentMigrationError("v1 elements is not an element array");
  }
  const elements = cloned["elements"].map(provisionalElement) as NativeElement[];
  const pageElements = Array.isArray(cloned["pageElements"])
    ? cloned["pageElements"].map((wrapper) => isRecord(wrapper)
      ? { ...wrapper, element: provisionalElement(wrapper["element"]) }
      : wrapper) as unknown as PageLevelWrapper[]
    : undefined;
  let finalized: CustomDefinitionRevisionSet;
  try {
    finalized = finalizeCustomDefinitionRevisions(undefined, {
      definitions,
      elements,
      ...(pageElements === undefined ? {} : { pageElements }),
    });
  } catch (error) {
    throw new DocumentMigrationError(
      error instanceof Error ? error.message : "custom-definition pins could not be finalized",
    );
  }
  return {
    ...cloned,
    version: 2,
    elements: finalized.elements,
    ...(cloned["customElementDefinitions"] === undefined
      ? {}
      : { customElementDefinitions: finalized.definitions }),
    ...(pageElements === undefined ? {} : { pageElements: finalized.pageElements }),
  };
}

/**
 * Normalize external input for current editor/use without mutating it.
 *
 * Version 1 is the only legacy format. Version 2 is returned unchanged and is
 * never repaired, so pin stripping from a current document fails validation.
 */
export function normalizeDocumentForCurrentUse(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value["version"] === 2) return value;
  if (value["version"] === 1) return migrateVersionOne(value);
  return value;
}

export function fromJson(
  value: unknown,
  catalog: SchemaCatalog,
): CbbDocument {
  const normalized = normalizeDocumentForCurrentUse(value);
  const result = catalog.validateAgainst(DOCUMENT_SCHEMA_ID, normalized);
  if (!result.valid) throw new DocumentValidationError(result.errors);
  return normalized as CbbDocument;
}

/** Current documents serialize by identity; v1 is converted before this API. */
export function toJson(doc: CbbDocument): Record<string, unknown> {
  return doc as unknown as Record<string, unknown>;
}
