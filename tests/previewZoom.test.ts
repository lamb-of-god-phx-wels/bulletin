import { describe, expect, it } from 'vitest';
import { PREVIEW_ZOOMS, stepPreviewZoom } from '../src/components/PreviewZoomControls';

describe('preview zoom controls', () => {
  it('uses the same discrete zoom levels in either direction', () => {
    expect(PREVIEW_ZOOMS).toEqual([.5, .6, .72, .85, 1, 1.25]);
    expect(stepPreviewZoom(.72, 1)).toBe(.85);
    expect(stepPreviewZoom(.72, -1)).toBe(.6);
  });

  it('steps sensibly from a custom fit value and clamps at the endpoints', () => {
    expect(stepPreviewZoom(.68, 1)).toBe(.72);
    expect(stepPreviewZoom(.68, -1)).toBe(.6);
    expect(stepPreviewZoom(.5, -1)).toBe(.5);
    expect(stepPreviewZoom(1.25, 1)).toBe(1.25);
  });
});
