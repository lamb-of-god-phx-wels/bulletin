import {
  validateFieldValue,
  type CbbDocument,
  type FieldDefinition,
} from "@cbb/core";
import type { DocumentPatch } from "./types.js";

export type SemanticMetadataRole = "publicationDate" | "serviceLabel";

function effectiveSemanticMetadataValue(
  field: FieldDefinition,
  values: CbbDocument["fieldValues"],
): string | undefined {
  const stored = values?.[field.id]?.value;
  const effective = stored !== undefined && validateFieldValue(field, stored)
    ? stored
    : field.default !== undefined && validateFieldValue(field, field.default)
      ? field.default
      : undefined;
  if (typeof effective !== "string") return undefined;
  if (field.semanticRole === "serviceLabel" && field.type === "choice") {
    const choices = field.constraints?.choices?.filter((choice) => choice.id === effective) ?? [];
    return choices.length === 1 ? choices[0]?.label : undefined;
  }
  return effective;
}

/** Reconcile selected top-level semantic-role mirrors after an atomic edit. */
export function semanticRoleMetadataMirrorPatches(input: {
  readonly document: CbbDocument;
  readonly contract: CbbDocument["fieldContract"];
  readonly values: CbbDocument["fieldValues"];
  readonly roles: readonly SemanticMetadataRole[];
}): readonly DocumentPatch[] {
  if (input.contract === undefined || input.roles.length === 0) return [];
  const next: Record<string, unknown> = { ...(input.document.metadata ?? {}) };
  for (const role of new Set(input.roles)) {
    const fields = input.contract.fields.filter((field) => field.semanticRole === role);
    // Invalid/ambiguous contracts are rejected elsewhere; do not guess a mirror.
    if (fields.length !== 1) continue;
    const expected = effectiveSemanticMetadataValue(fields[0] as FieldDefinition, input.values);
    if (expected === undefined) delete next[role];
    else next[role] = expected;
  }
  if (JSON.stringify(next) === JSON.stringify(input.document.metadata ?? {})) return [];
  if (Object.keys(next).length === 0) {
    return input.document.metadata === undefined ? [] : [{ op: "remove", path: "/metadata" }];
  }
  return [{
    op: input.document.metadata === undefined ? "add" : "replace",
    path: "/metadata",
    value: next,
  }];
}
