import { useState } from "react";
import { Button } from "../design-system/index.js";
import { CoverFocalImage } from "../editor/CoverFocalImage.js";
import type { CompleteFocalPoint } from "../store/index.js";
import { trapModalTab, useModalFocus } from "./modalFocus.js";

export function ImageReplacementReview({
  source,
  displayName,
  fit,
  currentFocalPoint,
  destinationAspectRatio,
  alt,
  decorative,
  onCancel,
  onConfirm,
}: {
  readonly source: string;
  readonly displayName: string;
  readonly fit: "contain" | "cover";
  readonly currentFocalPoint: CompleteFocalPoint;
  readonly destinationAspectRatio?: number | undefined;
  readonly alt?: string | undefined;
  readonly decorative: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (focalPoint: CompleteFocalPoint) => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>();
  const [cropChoice, setCropChoice] = useState<"center" | "keep">("center");
  const focalPoint = cropChoice === "keep"
    ? currentFocalPoint
    : { x: 0.5, y: 0.5 };
  const boundedCover = fit === "cover" && destinationAspectRatio !== undefined &&
    Number.isFinite(destinationAspectRatio) && destinationAspectRatio > 0;
  return (
    <div className="cbb-image-chooser-backdrop">
      <section
        ref={dialogRef}
        className="cbb-image-replacement-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cbb-image-replacement-title"
        aria-describedby="cbb-image-replacement-description"
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
            <h2 id="cbb-image-replacement-title">Review replacement image</h2>
            <p id="cbb-image-replacement-description">
              Preview {displayName} in this image’s destination before applying it.
            </p>
          </div>
        </header>
        <div
          className="cbb-image-replacement-review__preview"
          style={destinationAspectRatio === undefined
            ? undefined
            : {
                aspectRatio: String(destinationAspectRatio),
                width: `min(100%, calc(22rem * ${destinationAspectRatio}))`,
                height: "auto",
                minHeight: 0,
                marginInline: "auto",
              }}
        >
          {boundedCover
            ? (
                <CoverFocalImage
                  source={source}
                  alt="Replacement image crop preview"
                  focalX={focalPoint.x}
                  focalY={focalPoint.y}
                />
              )
            : (
                <img
                  src={source}
                  alt="Replacement image preview"
                  style={{ objectFit: fit }}
                />
              )}
        </div>
        {fit === "cover"
          ? (
              <fieldset>
                <legend>Starting crop point</legend>
                <label>
                  <input
                    type="radio"
                    name="replacement-crop"
                    value="center"
                    checked={cropChoice === "center"}
                    onChange={() => setCropChoice("center")}
                  />
                  Start this image at the center
                </label>
                <label>
                  <input
                    type="radio"
                    name="replacement-crop"
                    value="keep"
                    checked={cropChoice === "keep"}
                    onChange={() => setCropChoice("keep")}
                  />
                  Keep current crop point
                </label>
              </fieldset>
            )
          : null}
        <div className="cbb-image-replacement-review__accessibility" role="note">
          <strong>Review the image description after replacing.</strong>
          <span>{decorative
            ? "This item is currently marked decorative. Confirm that the replacement also adds no meaning."
            : alt?.trim()
              ? `Current description: ${alt}`
              : "This meaningful image still needs a description."}</span>
        </div>
        <div className="cbb-inline-actions">
          <Button variant="primary" onClick={() => onConfirm(focalPoint)}>
            Apply replacement
          </Button>
          <Button autoFocus onClick={onCancel}>Cancel</Button>
        </div>
      </section>
    </div>
  );
}
