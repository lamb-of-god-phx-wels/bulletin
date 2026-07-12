import type {
  RenderProjection,
  ResolvedRenderTree,
} from "../document/resolvedTypes.js";
import type { TypstSourceMap } from "./sourceBuilder.js";

export interface TypstAssetBinding {
  /** App-controlled path below the isolated build root. */
  readonly relativePath: string;
}

export interface TypstFontBinding {
  /** Validated internal family name exposed by the isolated font directory. */
  readonly familyName: string;
}

export interface TypstGenerationInput {
  readonly tree: ResolvedRenderTree;
  readonly projection: RenderProjection;
}

export interface TypstGenerationOptions {
  readonly assets?: Readonly<Record<string, TypstAssetBinding>>;
  readonly fonts?: Readonly<Record<string, TypstFontBinding>>;
}

export type TypstGenerationFindingKind =
  | "missingAsset"
  | "missingFont"
  | "missingAltText"
  | "invalidDate"
  | "invalidLayout"
  | "unsupportedImageFocalPoint"
  | "unsupportedPageSemantics"
  | "unsupportedTableSemantics"
  | "unsupportedCanvasSemantics"
  | "unsupportedLocale"
  | "missingDocumentTitle"
  | "unsupportedTypographyPreset"
  | "duplicateRightsBlock"
  | "rightsGeneration";

export interface TypstGenerationFinding {
  readonly code:
    | "CBB-ASSET-0001"
    | "CBB-FONT-0001"
    | "CBB-DOC-0001"
    | "CBB-LAYOUT-0002"
    | "CBB-LAYOUT-0003"
    | "CBB-PDF-0002"
    | "CBB-RIGHTS-0001"
    | "CBB-RIGHTS-0002";
  readonly severity: "warning" | "error";
  readonly kind: TypstGenerationFindingKind;
  readonly message: string;
  readonly resolvedId?: string;
}

export interface TypstGenerationResult {
  readonly generatorVersion: typeof TYPST_GENERATOR_VERSION;
  readonly source: string;
  readonly sourceMap: TypstSourceMap;
  readonly findings: readonly TypstGenerationFinding[];
}

export const TYPST_GENERATOR_VERSION = "cbb-typstgen-v2" as const;
