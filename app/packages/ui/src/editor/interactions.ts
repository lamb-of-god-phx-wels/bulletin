import {
  absoluteIn,
  lengthToEditorPixels,
  parseLength,
  rational,
  toInchString,
} from "@cbb/core";

export function snapEditorPixels(
  value: number,
  enabled: boolean,
  step = 8,
): number {
  const finite = Number.isFinite(value) ? value : 0;
  if (!enabled || !Number.isFinite(step) || step <= 0) return Math.round(finite);
  return Math.round(finite / step) * step;
}

export function editorPixelsToInches(value: number): string {
  const pixels = BigInt(Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
  return toInchString(absoluteIn(rational(pixels, 96n)));
}

export function persistedLengthToEditorPixels(
  value: string | number | "auto" | undefined,
  fallback: number,
): number {
  if (typeof value === "number") return value;
  if (value === undefined || value === "auto") return fallback;
  try {
    const length = parseLength(value);
    return length.kind === "absolute"
      ? Number(lengthToEditorPixels(length))
      : fallback;
  } catch {
    return fallback;
  }
}

export function clampFocalPoint(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export interface CoverFocalCrop {
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * Place a focal point at the crop-window center until an image edge makes that
 * impossible, then clamp to that edge. This is the persisted CBB crop formula,
 * not CSS object-position's proportional-overflow formula.
 */
export function coverFocalCrop(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly focalX: number;
  readonly focalY: number;
}): CoverFocalCrop | undefined {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight } = input;
  if (
    ![sourceWidth, sourceHeight, targetWidth, targetHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) return undefined;
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const overflowX = Math.max(0, renderedWidth - targetWidth);
  const overflowY = Math.max(0, renderedHeight - targetHeight);
  const focalX = clampFocalPoint(input.focalX);
  const focalY = clampFocalPoint(input.focalY);
  return {
    renderedWidth,
    renderedHeight,
    originX: Math.max(0, Math.min(overflowX, focalX * renderedWidth - targetWidth / 2)),
    originY: Math.max(0, Math.min(overflowY, focalY * renderedHeight - targetHeight / 2)),
  };
}
