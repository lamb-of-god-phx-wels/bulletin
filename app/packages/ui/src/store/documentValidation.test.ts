import { describe, expect, it } from "vitest";
import type { CbbDocument } from "@cbb/core";
import {
  EditorDocumentValidationError,
  assertEditorDocumentValid,
} from "./documentValidation.js";
import { bulletin } from "./testFixtures.js";

describe("renderer document validation", () => {
  it("accepts the same valid document shape used by the editor", () => {
    expect(() => assertEditorDocumentValid(bulletin())).not.toThrow();
  });

  it("rejects structurally invalid document values before a commit", () => {
    const invalid = { ...bulletin(), version: 3 } as unknown as CbbDocument;
    expect(() => assertEditorDocumentValid(invalid)).toThrow(EditorDocumentValidationError);
    try {
      assertEditorDocumentValid(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(EditorDocumentValidationError);
      expect((error as EditorDocumentValidationError).structuralErrors.length).toBeGreaterThan(0);
    }
  });

  it("rejects cross-tree semantic violations after schema validation", () => {
    const valid = bulletin();
    const invalid = {
      ...valid,
      elements: [valid.elements[0]!, { ...valid.elements[1]!, id: valid.elements[0]!.id }],
    } as CbbDocument;
    expect(() => assertEditorDocumentValid(invalid)).toThrow(EditorDocumentValidationError);
    try {
      assertEditorDocumentValid(invalid);
    } catch (error) {
      expect((error as EditorDocumentValidationError).semanticFindings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "CBB-DOC-0100" })]),
      );
    }
  });
});
