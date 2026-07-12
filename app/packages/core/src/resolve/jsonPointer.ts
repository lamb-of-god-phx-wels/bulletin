/** Small, prototype-safe RFC 6901 helpers used only after target allowlisting. */

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function parseJsonPointer(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;

  const result: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    if (/(?:~[^01]|~$)/u.test(raw)) return undefined;
    const segment = raw.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    result.push(segment);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPointer(root: unknown, pointer: string): unknown {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined) return undefined;
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function cloneContainer(value: unknown): unknown[] | Record<string, unknown> | undefined {
  if (Array.isArray(value)) return [...value];
  if (isRecord(value)) return { ...value };
  return undefined;
}

export function writePointer(
  root: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined || segments.length === 0) return undefined;
  const copy = { ...root };
  let source: unknown = root;
  let target: unknown = copy;

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index] as string;
    const sourceChild = Array.isArray(source)
      ? source[Number(segment)]
      : isRecord(source)
        ? source[segment]
        : undefined;
    const cloned = cloneContainer(sourceChild);
    if (cloned === undefined) return undefined;
    if (Array.isArray(target)) target[Number(segment)] = cloned;
    else if (isRecord(target)) target[segment] = cloned;
    else return undefined;
    source = sourceChild;
    target = cloned;
  }

  const leaf = segments[segments.length - 1] as string;
  if (Array.isArray(target)) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(leaf)) return undefined;
    const leafIndex = Number(leaf);
    if (!Number.isSafeInteger(leafIndex) || leafIndex >= target.length) return undefined;
    target[leafIndex] = value;
  } else if (isRecord(target)) {
    target[leaf] = value;
  } else {
    return undefined;
  }
  return copy;
}

export function deletePointer(
  root: Record<string, unknown>,
  pointer: string,
): Record<string, unknown> | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined || segments.length === 0) return undefined;
  const copy = { ...root };
  let source: unknown = root;
  let target: unknown = copy;

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index] as string;
    const sourceChild = Array.isArray(source)
      ? source[Number(segment)]
      : isRecord(source)
        ? source[segment]
        : undefined;
    const cloned = cloneContainer(sourceChild);
    if (cloned === undefined) return copy;
    if (Array.isArray(target)) target[Number(segment)] = cloned;
    else if (isRecord(target)) target[segment] = cloned;
    else return undefined;
    source = sourceChild;
    target = cloned;
  }

  const leaf = segments[segments.length - 1] as string;
  if (Array.isArray(target)) return undefined;
  if (!isRecord(target)) return undefined;
  delete target[leaf];
  return copy;
}
