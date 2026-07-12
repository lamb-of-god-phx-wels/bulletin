import type {
  FieldContract,
  FieldDefinition,
  FieldType,
  FieldValues,
  NativeElement,
} from "../document/types.js";
import { matchesSafeFieldPattern } from "../document/safePattern.js";
import { isRichTextDocument } from "../richtext/index.js";
import { parseJsonPointer, readPointer } from "./jsonPointer.js";

export interface FieldScope {
  readonly contract?: FieldContract;
  readonly values?: FieldValues;
}

export type EffectiveValueSource = "stored" | "default" | "fallback";

export interface EffectiveFieldResult {
  readonly definition?: FieldDefinition;
  readonly value?: unknown;
  readonly source?: EffectiveValueSource;
  readonly invalidSources: readonly EffectiveValueSource[];
  readonly missing: boolean;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] as number);
}

function stringConstraintsValid(
  value: string,
  definition: FieldDefinition,
): boolean {
  const constraints = definition.constraints;
  if (constraints === undefined) return true;
  const length = scalarLength(value);
  if (constraints.minLength !== undefined && length < constraints.minLength) return false;
  if (constraints.maxLength !== undefined && length > constraints.maxLength) return false;
  if (
    constraints.pattern !== undefined &&
    !matchesSafeFieldPattern(value, constraints.pattern)
  ) {
    return false;
  }
  return true;
}

export function validateFieldValue(
  definition: FieldDefinition,
  value: unknown,
  depth = 0,
): boolean {
  if (depth > 32) return false;
  if (value === null) return definition.nullable === true;

  switch (definition.type) {
    case "text":
      return typeof value === "string" && stringConstraintsValid(value, definition);
    case "richText":
      return isRichTextDocument(value);
    case "date":
      return typeof value === "string" && isCalendarDate(value);
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      const constraints = definition.constraints;
      return !(
        (constraints?.minimum !== undefined && value < constraints.minimum) ||
        (constraints?.maximum !== undefined && value > constraints.maximum)
      );
    }
    case "boolean":
      return typeof value === "boolean";
    case "choice":
      return (
        typeof value === "string" &&
        stringConstraintsValid(value, definition) &&
        (definition.constraints?.choices?.some((choice) => choice.id === value) ?? false)
      );
    case "assetRef":
      return (
        typeof value === "string" &&
        /^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          value,
        )
      );
    case "array": {
      if (!Array.isArray(value) || definition.itemField === undefined) return false;
      const constraints = definition.constraints;
      if (constraints?.minItems !== undefined && value.length < constraints.minItems) return false;
      if (constraints?.maxItems !== undefined && value.length > constraints.maxItems) return false;
      return value.every((item) =>
        validateFieldValue(definition.itemField as FieldDefinition, item, depth + 1),
      );
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const children = definition.childFields ?? [];
      const declared = new Map(children.map((child) => [child.id, child]));
      for (const key of Object.keys(record)) {
        const child = declared.get(key);
        if (child === undefined || !validateFieldValue(child, record[key], depth + 1)) {
          return false;
        }
      }
      for (const child of children) {
        if (child.required && !Object.hasOwn(record, child.id)) {
          if (
            child.default === undefined ||
            !validateFieldValue(child, child.default, depth + 1)
          ) {
            return false;
          }
        }
      }
      return true;
    }
  }
}

export function findFieldDefinition(
  contract: FieldContract | undefined,
  fieldId: string,
): FieldDefinition | undefined {
  return contract?.fields.find((field) => field.id === fieldId);
}

export function resolveEffectiveField(
  scope: FieldScope,
  fieldId: string,
  fallback?: unknown,
): EffectiveFieldResult {
  const definition = findFieldDefinition(scope.contract, fieldId);
  if (definition === undefined) {
    return { invalidSources: [], missing: true };
  }

  const invalidSources: EffectiveValueSource[] = [];
  const entry = scope.values?.[fieldId];
  if (entry !== undefined) {
    if (validateFieldValue(definition, entry.value)) {
      return {
        definition,
        value: entry.value,
        source: "stored",
        invalidSources,
        missing: false,
      };
    }
    invalidSources.push("stored");
  }

  if (definition.default !== undefined) {
    if (validateFieldValue(definition, definition.default)) {
      return {
        definition,
        value: definition.default,
        source: "default",
        invalidSources,
        missing: false,
      };
    }
    invalidSources.push("default");
  }

  if (fallback !== undefined) {
    if (validateFieldValue(definition, fallback)) {
      return {
        definition,
        value: fallback,
        source: "fallback",
        invalidSources,
        missing: false,
      };
    }
    invalidSources.push("fallback");
  }

  return { definition, invalidSources, missing: true };
}

export interface BindingTargetSpec {
  readonly acceptedTypes: readonly FieldType[];
  readonly optional: boolean;
  readonly wrapsTextContent?: boolean;
}

/** Schema-owned v1 binding allowlist. Geometry/style/children are unreachable. */
export function bindingTargetSpec(
  element: NativeElement,
  pointer: string,
): BindingTargetSpec | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined || segments[0] !== "data") return undefined;

  if (element.type === "text") {
    if (pointer === "/data/content") {
      return { acceptedTypes: ["text", "richText"], optional: false, wrapsTextContent: true };
    }
    if (pointer === "/data/content/text") {
      return element.data.content.kind === "plain"
        ? { acceptedTypes: ["text", "choice"], optional: false }
        : undefined;
    }
    if (pointer === "/data/content/document") {
      return element.data.content.kind === "richText"
        ? { acceptedTypes: ["richText"], optional: false }
        : undefined;
    }
    if (
      segments.length >= 5 &&
      segments[1] === "content" &&
      segments[2] === "document" &&
      segments[segments.length - 1] === "text"
    ) {
      const parentPointer = pointer.slice(0, pointer.lastIndexOf("/"));
      const parent = readPointer(element, parentPointer);
      return typeof parent === "object" &&
        parent !== null &&
        !Array.isArray(parent) &&
        (parent as Record<string, unknown>).type === "text"
        ? { acceptedTypes: ["text", "choice"], optional: false }
        : undefined;
    }
    return undefined;
  }

  if (element.type === "image") {
    if (pointer === "/data/assetRef") return { acceptedTypes: ["assetRef"], optional: false };
    if (pointer === "/data/alt") return { acceptedTypes: ["text"], optional: true };
    if (pointer === "/data/decorative") return { acceptedTypes: ["boolean"], optional: true };
    if (pointer === "/data/focalPoint/x" || pointer === "/data/focalPoint/y") {
      return { acceptedTypes: ["number"], optional: true };
    }
    return undefined;
  }

  if (element.type === "date") {
    if (pointer === "/data/value") return { acceptedTypes: ["date"], optional: false };
    if (["/data/format", "/data/locale", "/data/prefix", "/data/suffix"].includes(pointer)) {
      return { acceptedTypes: ["text", "choice"], optional: true };
    }
    return undefined;
  }

  if (element.type === "music") {
    if (pointer === "/data/title") return { acceptedTypes: ["text"], optional: false };
    if (["/data/number", "/data/instructions", "/data/source"].includes(pointer)) {
      return { acceptedTypes: ["text", "choice"], optional: true };
    }
    if (pointer === "/data/richContent") {
      return { acceptedTypes: ["richText"], optional: true };
    }
    return undefined;
  }

  if (element.type === "rightsAttribution") {
    if (pointer === "/data/heading" || pointer === "/data/introText") {
      return { acceptedTypes: ["text"], optional: true };
    }
    if (pointer === "/data/includePublicDomainLines") {
      return { acceptedTypes: ["boolean"], optional: true };
    }
  }
  return undefined;
}

export function definitionAtItemPointer(
  itemDefinition: FieldDefinition,
  pointer: string,
): FieldDefinition | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments === undefined) return undefined;
  let current = itemDefinition;
  for (const segment of segments) {
    if (current.type === "object") {
      const child = current.childFields?.find((candidate) => candidate.id === segment);
      if (child === undefined) return undefined;
      current = child;
      continue;
    }
    if (current.type === "array" && /^(?:0|[1-9][0-9]*)$/u.test(segment)) {
      if (current.itemField === undefined) return undefined;
      current = current.itemField;
      continue;
    }
    return undefined;
  }
  return current;
}
