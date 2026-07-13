import { validateDocumentSemantics, type CbbDocument } from "@cbb/core";
import type { DocumentPatch } from "./types.js";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const IMMUTABLE_DOCUMENTS = new WeakSet<object>();

export class DocumentPatchError extends Error {
  readonly patchIndex?: number;

  constructor(message: string, patchIndex?: number) {
    super(
      patchIndex === undefined ? message : `Patch ${patchIndex}: ${message}`,
    );
    this.name = "DocumentPatchError";
    if (patchIndex !== undefined) this.patchIndex = patchIndex;
  }
}

export interface DocumentPatchApplication {
  readonly document: CbbDocument;
  readonly patches: readonly DocumentPatch[];
  readonly inversePatches: readonly DocumentPatch[];
}

type JsonContainer = unknown[] | Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): value is JsonContainer {
  return Array.isArray(value) || isObject(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DocumentPatchError("Patch values must contain finite numbers");
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new DocumentPatchError("Patch values must be JSON-compatible");
  }
  if (ancestors.has(value)) {
    throw new DocumentPatchError("Patch values must not contain cycles");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const cloned: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new DocumentPatchError("Patch values must not contain sparse arrays");
        }
        cloned.push(cloneJson(value[index], ancestors));
      }
      return cloned;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentPatchError("Patch values must contain only plain objects");
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(cloned, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneJson(entry, ancestors),
      });
    }
    return cloned;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze<T>(value: T, visited = new Set<object>()): T {
  if (typeof value !== "object" || value === null || visited.has(value)) {
    return value;
  }
  visited.add(value);
  for (const child of Object.values(value)) deepFreeze(child, visited);
  return Object.freeze(value);
}

function decodePointer(path: string): readonly string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new DocumentPatchError("JSON Pointer paths must be empty or start with '/'");
  }
  return path.slice(1).split("/").map((encoded) => {
    if (/~(?:[^01]|$)/u.test(encoded)) {
      throw new DocumentPatchError(`Invalid JSON Pointer escape in '${path}'`);
    }
    const decoded = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (UNSAFE_PATH_SEGMENTS.has(decoded)) {
      throw new DocumentPatchError(`Unsafe JSON Pointer segment '${decoded}'`);
    }
    return decoded;
  });
}

function encodePointer(segments: readonly string[]): string {
  return segments.length === 0
    ? ""
    : `/${segments
        .map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1"))
        .join("/")}`;
}

function parseArrayIndex(
  segment: string,
  length: number,
  operation: DocumentPatch["op"],
): number {
  if (segment === "-") {
    if (operation !== "add") {
      throw new DocumentPatchError("The '-' array index is valid only for add");
    }
    return length;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(segment)) {
    throw new DocumentPatchError(`Invalid array index '${segment}'`);
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    throw new DocumentPatchError(`Array index '${segment}' is too large`);
  }
  const maximum = operation === "add" ? length : length - 1;
  if (index > maximum) {
    throw new DocumentPatchError(
      `Array index ${index} is out of bounds for length ${length}`,
    );
  }
  return index;
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[parseArrayIndex(segment, current.length, "replace")];
    } else if (isObject(current)) {
      if (!hasOwn(current, segment)) {
        throw new DocumentPatchError(`Path does not exist at '${segment}'`);
      }
      current = current[segment];
    } else {
      throw new DocumentPatchError(`Path traverses a non-container at '${segment}'`);
    }
  }
  return current;
}

function updateParent(
  root: unknown,
  parentSegments: readonly string[],
  update: (parent: JsonContainer) => JsonContainer,
): unknown {
  if (parentSegments.length === 0) {
    if (!isContainer(root)) {
      throw new DocumentPatchError("Patch parent is not a container");
    }
    return update(root);
  }

  const [segment, ...remaining] = parentSegments;
  if (segment === undefined) return root;

  if (Array.isArray(root)) {
    const index = parseArrayIndex(segment, root.length, "replace");
    const child = root[index];
    const updatedChild = updateParent(child, remaining, update);
    const cloned = root.slice();
    cloned[index] = updatedChild;
    return cloned;
  }
  if (isObject(root)) {
    if (!hasOwn(root, segment)) {
      throw new DocumentPatchError(`Path does not exist at '${segment}'`);
    }
    const cloned = { ...root };
    cloned[segment] = updateParent(root[segment], remaining, update);
    return cloned;
  }
  throw new DocumentPatchError(`Path traverses a non-container at '${segment}'`);
}

function normalizePatch(patch: DocumentPatch): DocumentPatch {
  if (patch.op !== "add" && patch.op !== "remove" && patch.op !== "replace") {
    throw new DocumentPatchError("Unsupported document patch operation");
  }
  if (typeof patch.path !== "string") {
    throw new DocumentPatchError("Document patch paths must be strings");
  }
  decodePointer(patch.path);
  if (patch.op === "remove") return Object.freeze({ ...patch });
  return Object.freeze({ ...patch, value: deepFreeze(cloneJson(patch.value)) });
}

function applyOne(
  root: unknown,
  patch: DocumentPatch,
): { readonly root: unknown; readonly inverse: DocumentPatch } {
  const segments = decodePointer(patch.path);

  if (segments.length === 0) {
    if (patch.op === "remove") {
      throw new DocumentPatchError("The document root cannot be removed");
    }
    const previous = deepFreeze(cloneJson(root));
    return {
      root: cloneJson(patch.value),
      inverse: { op: "replace", path: "", value: previous },
    };
  }

  const key = segments.at(-1);
  if (key === undefined) throw new DocumentPatchError("Patch path has no target");
  const parentSegments = segments.slice(0, -1);
  let inverse: DocumentPatch | undefined;
  let actualSegments = segments;

  const nextRoot = updateParent(root, parentSegments, (parent) => {
    if (Array.isArray(parent)) {
      const index = parseArrayIndex(key, parent.length, patch.op);
      actualSegments = [...parentSegments, String(index)];
      const cloned = parent.slice();
      if (patch.op === "add") {
        cloned.splice(index, 0, cloneJson(patch.value));
        inverse = { op: "remove", path: encodePointer(actualSegments) };
      } else if (patch.op === "remove") {
        const previous = cloneJson(parent[index]);
        cloned.splice(index, 1);
        inverse = {
          op: "add",
          path: encodePointer(actualSegments),
          value: previous,
        };
      } else {
        const previous = cloneJson(parent[index]);
        cloned[index] = cloneJson(patch.value);
        inverse = {
          op: "replace",
          path: encodePointer(actualSegments),
          value: previous,
        };
      }
      return cloned;
    }

    const existed = hasOwn(parent, key);
    if (patch.op !== "add" && !existed) {
      throw new DocumentPatchError(`Path does not exist at '${key}'`);
    }
    const cloned = { ...parent };
    if (patch.op === "add") {
      const previous = existed ? cloneJson(parent[key]) : undefined;
      cloned[key] = cloneJson(patch.value);
      inverse = existed
        ? { op: "replace", path: patch.path, value: previous }
        : { op: "remove", path: patch.path };
    } else if (patch.op === "remove") {
      const previous = cloneJson(parent[key]);
      delete cloned[key];
      inverse = { op: "add", path: patch.path, value: previous };
    } else {
      const previous = cloneJson(parent[key]);
      cloned[key] = cloneJson(patch.value);
      inverse = { op: "replace", path: patch.path, value: previous };
    }
    return cloned;
  });

  if (inverse === undefined) {
    throw new DocumentPatchError("Could not derive an inverse patch");
  }
  return { root: nextRoot, inverse };
}

function assertDocumentShape(value: unknown): asserts value is CbbDocument {
  if (
    !isObject(value) ||
    value["version"] !== 2 ||
    (value["kind"] !== "bulletin" && value["kind"] !== "template") ||
    typeof value["name"] !== "string" ||
    !isObject(value["page"]) ||
    !Array.isArray(value["elements"])
  ) {
    throw new DocumentPatchError("Patches produced an invalid document root");
  }
}

function assertDocumentSemantics(document: CbbDocument): void {
  try {
    const validation = validateDocumentSemantics(document);
    if (!validation.valid) {
      const finding = validation.findings[0];
      throw new DocumentPatchError(
        finding === undefined
          ? "Patches produced a semantically invalid document"
          : `Patches produced a semantically invalid document: ${finding.code} ${finding.message}`,
      );
    }
  } catch (error) {
    if (error instanceof DocumentPatchError) throw error;
    throw new DocumentPatchError(
      `Patches produced a structurally invalid document: ${error instanceof Error ? error.message : "validation failed"}`,
    );
  }
}

/** Clone and freeze a document before it enters editor state. */
export function immutableDocument(document: CbbDocument): CbbDocument {
  if (IMMUTABLE_DOCUMENTS.has(document)) return document;
  const cloned = cloneJson(document);
  assertDocumentShape(cloned);
  assertDocumentSemantics(cloned);
  const immutable = deepFreeze(cloned);
  IMMUTABLE_DOCUMENTS.add(immutable);
  return immutable;
}

/**
 * Apply a patch transaction atomically and derive its exact inverse.  The
 * original document and caller-owned patch values are never mutated or retained.
 */
export function applyDocumentPatches(
  document: CbbDocument,
  patches: readonly DocumentPatch[],
): DocumentPatchApplication {
  let current: unknown = immutableDocument(document);
  const normalized: DocumentPatch[] = [];
  const inverse: DocumentPatch[] = [];

  try {
    for (const input of patches) {
      const patch = normalizePatch(input);
      const applied = applyOne(current, patch);
      current = applied.root;
      normalized.push(patch);
      inverse.unshift(normalizePatch(applied.inverse));
    }
  } catch (error) {
    if (error instanceof DocumentPatchError) {
      const index = normalized.length;
      throw new DocumentPatchError(error.message, index);
    }
    throw error;
  }

  assertDocumentShape(current);
  assertDocumentSemantics(current);
  const immutable = deepFreeze(current);
  IMMUTABLE_DOCUMENTS.add(immutable);
  return {
    document: immutable,
    patches: Object.freeze(normalized),
    inversePatches: Object.freeze(inverse),
  };
}

/** JSON-value equality used to avoid empty history entries. */
export function documentValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      const leftHas = Object.prototype.hasOwnProperty.call(left, index);
      const rightHas = Object.prototype.hasOwnProperty.call(right, index);
      if (leftHas !== rightHas) return false;
      if (leftHas && !documentValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => hasOwn(right, key) && documentValuesEqual(left[key], right[key]),
    );
  }
  return false;
}

/** Read-only lookup used by tests and command factories. */
export function documentValueAt(document: CbbDocument, path: string): unknown {
  return valueAt(document, decodePointer(path));
}
