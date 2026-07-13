import { describe, expect, it } from "vitest";
import {
  clampFocalPoint,
  coverFocalCrop,
  editorPixelsToInches,
  persistedLengthToEditorPixels,
  snapEditorPixels,
} from "./interactions.js";

describe("editor pointer and keyboard geometry", () => {
  it("uses the same deterministic snap calculation for drag and keyboard paths", () => {
    expect(snapEditorPixels(13, true, 8)).toBe(16);
    expect(snapEditorPixels(11, true, 8)).toBe(8);
    expect(snapEditorPixels(13, false, 8)).toBe(13);
  });

  it("persists editor pixels as bounded physical inches", () => {
    expect(editorPixelsToInches(96)).toBe("1in");
    expect(editorPixelsToInches(48)).toBe("0.5in");
    expect(editorPixelsToInches(-20)).toBe("0in");
    expect(persistedLengthToEditorPixels("0.5in", 99)).toBe(48);
    expect(persistedLengthToEditorPixels("auto", 99)).toBe(99);
  });

  it("clamps crop focal points without changing valid values", () => {
    expect([clampFocalPoint(-1), clampFocalPoint(4)]).toEqual([0, 1]);
    expect([clampFocalPoint(0.25), clampFocalPoint(0.75)]).toEqual([0.25, 0.75]);
  });

  it("centers an asymmetric cover focal point and clamps only at source edges", () => {
    expect(coverFocalCrop({
      sourceWidth: 1200,
      sourceHeight: 400,
      targetWidth: 200,
      targetHeight: 200,
      focalX: 0.2,
      focalY: 0.8,
    })).toEqual({
      renderedWidth: 600,
      renderedHeight: 200,
      // 0.2 × 600 − 200 / 2 = 20. CSS object-position would incorrectly use 80.
      originX: 20,
      originY: 0,
    });
    expect(coverFocalCrop({
      sourceWidth: 400,
      sourceHeight: 1200,
      targetWidth: 200,
      targetHeight: 200,
      focalX: 0,
      focalY: 1,
    })).toEqual({
      renderedWidth: 200,
      renderedHeight: 600,
      originX: 0,
      originY: 400,
    });
  });
});
