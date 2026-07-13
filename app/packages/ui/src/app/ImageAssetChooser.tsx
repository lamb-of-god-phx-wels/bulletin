import { Button } from "../design-system/index.js";
import type { RendererImageAssetSummary } from "../bridge/imageAssets.js";
import { trapModalTab, useModalFocus } from "./modalFocus.js";

function dimensions(asset: RendererImageAssetSummary): string {
  if (asset.pixelWidth === undefined || asset.pixelHeight === undefined) {
    return asset.mediaType === "image/svg+xml" ? "Scalable vector image" : "Raster image";
  }
  return `${asset.pixelWidth} × ${asset.pixelHeight} pixels`;
}

export function ImageAssetChooser({
  assets,
  assetUrl,
  busy,
  importing,
  error,
  onImport,
  onChoose,
  onCancel,
}: {
  readonly assets: readonly RendererImageAssetSummary[];
  readonly assetUrl: (assetRef: string) => string | undefined;
  readonly busy: boolean;
  readonly importing: boolean;
  readonly error?: string | undefined;
  readonly onImport: () => void;
  readonly onChoose: (assetRef: string) => void;
  readonly onCancel: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>();
  return (
    <div className="cbb-image-chooser-backdrop">
      <section
        ref={dialogRef}
        className="cbb-image-chooser"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cbb-image-chooser-title"
        aria-describedby="cbb-image-chooser-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          trapModalTab(event, dialogRef.current);
        }}
      >
        <header>
          <div>
            <h2 id="cbb-image-chooser-title">Choose an installed image</h2>
            <p id="cbb-image-chooser-description">
              Only immutable images that passed the application’s validation process appear here.
            </p>
          </div>
          <div className="cbb-inline-actions">
            <Button disabled={busy || importing} onClick={onImport}>
              {importing ? "Importing image…" : "Import image"}
            </Button>
            <Button autoFocus disabled={importing} onClick={onCancel}>Cancel</Button>
          </div>
        </header>
        {error === undefined ? null : <p className="cbb-route-notice cbb-route-notice--warning" role="alert">{error}</p>}
        {busy
          ? <p role="status">Opening the validated image library…</p>
          : assets.length === 0
            ? (
              <div className="cbb-image-chooser__empty" role="status">
                <strong>No validated images are installed yet.</strong>
                <span>Import a PNG, JPEG, or SVG image to use it in this bulletin.</span>
              </div>
            )
            : (
              <ul className="cbb-image-chooser__grid" aria-label="Installed images">
                {assets.map((asset) => {
                  const source = assetUrl(asset.assetRef);
                  return (
                    <li key={asset.assetRef}>
                      <button type="button" onClick={() => onChoose(asset.assetRef)}>
                        {source === undefined
                          ? <span className="cbb-image-chooser__preview" aria-hidden="true">Preview unavailable</span>
                          : <img src={source} alt="" />}
                        <strong>{asset.displayName}</strong>
                        <span>{dimensions(asset)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
      </section>
    </div>
  );
}
