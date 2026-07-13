import {
  DOCUMENT_SCHEMA_ID,
  DocumentValidationError,
  createSchemaCatalog,
  fromJson,
  validateDocumentSemantics,
  type CbbDocument,
  type SchemaObject,
  type SemanticDiagnostic,
  type ValidationError,
} from "@cbb/core";
import commonSchemaSource from "../../../../schemas/v1/common.schema.json?raw";
import customElementSchemaSource from "../../../../schemas/v1/customElement.schema.json?raw";
import documentSchemaSource from "../../../../schemas/v1/document.schema.json?raw";
import elementSchemaSource from "../../../../schemas/v1/element.schema.json?raw";
import richTextSchemaSource from "../../../../schemas/v1/richText.schema.json?raw";
import rightsSchemaSource from "../../../../schemas/v1/rights.schema.json?raw";

const SCHEMA_SOURCES = Object.freeze([
  commonSchemaSource,
  customElementSchemaSource,
  documentSchemaSource,
  elementSchemaSource,
  richTextSchemaSource,
  rightsSchemaSource,
]);

function bundledDocumentCatalog() {
  const schemas = new Map<string, SchemaObject>();
  for (const source of SCHEMA_SOURCES) {
    const schema = JSON.parse(source) as SchemaObject;
    if (typeof schema.$id !== "string" || schema.$id.length === 0 || schemas.has(schema.$id)) {
      throw new Error("The bundled editor schema catalog is invalid.");
    }
    schemas.set(schema.$id, schema);
  }
  if (!schemas.has(DOCUMENT_SCHEMA_ID)) {
    throw new Error("The bundled editor schema catalog is incomplete.");
  }
  return createSchemaCatalog(schemas);
}

const EDITOR_DOCUMENT_CATALOG = bundledDocumentCatalog();

export class EditorDocumentValidationError extends Error {
  constructor(
    readonly structuralErrors: readonly ValidationError[],
    readonly semanticFindings: readonly SemanticDiagnostic[],
  ) {
    const first = structuralErrors[0]?.message ?? semanticFindings[0]?.message ??
      "The bulletin would be invalid.";
    super(`That edit cannot be applied safely: ${first}`);
    this.name = "EditorDocumentValidationError";
  }
}

/**
 * Synchronous, renderer-safe gate used for every EditorStore commit. The JSON
 * schemas are bundled as inert strings, so validation performs no I/O and
 * grants the renderer no filesystem or network capability.
 */
export function assertEditorDocumentValid(document: CbbDocument): void {
  let parsed: CbbDocument;
  try {
    parsed = fromJson(document, EDITOR_DOCUMENT_CATALOG);
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      throw new EditorDocumentValidationError(error.errors, []);
    }
    throw error;
  }
  const semantic = validateDocumentSemantics(parsed);
  if (!semantic.valid) {
    throw new EditorDocumentValidationError([], semantic.findings);
  }
}
