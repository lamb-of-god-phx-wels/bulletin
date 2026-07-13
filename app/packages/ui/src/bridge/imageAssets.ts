export interface RendererImageAssetSummary {
  readonly localAssetId: string;
  readonly assetRef: string;
  readonly displayName: string;
  readonly mediaType: "image/png" | "image/svg+xml";
  readonly byteSize: number;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly importedAt: string;
}

export type RendererImageAssetImportOutcome =
  | { readonly status: "canceled" }
  | { readonly status: "imported"; readonly asset: RendererImageAssetSummary }
  | { readonly status: "readOnly" | "unavailable"; readonly message: string };
