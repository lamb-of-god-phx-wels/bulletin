import { describe, expect, it } from 'vitest';
import {
  canvasBindingText,
  convertCanvasCoordinateSpace,
  defaultCanvasScene,
  snapCanvasValue,
  snapCanvasPosition,
  validateCanvasScene
} from '../src/shared/canvas';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';

describe('canvas cover scenes', () => {
  it('uses deterministic bindings and date formats', () => {
    const document = createBulletin(defaultTemplate, '2026-07-27');
    document.info.title = 'The Good Shepherd';
    expect(canvasBindingText('info.title', document)).toBe('The Good Shepherd');
    expect(canvasBindingText('info.date', document, 'long')).toBe('July 27, 2026');
    expect(canvasBindingText('info.date', document, 'iso')).toBe('2026-07-27');
  });

  it('converts coordinate spaces without changing physical positions', () => {
    const scene = defaultCanvasScene();
    const converted = convertCanvasCoordinateSpace(scene, 'contentBox', .4);
    expect(converted.elements[0].x + .4).toBeCloseTo(scene.elements[0].x);
    expect(converted.elements[0].y + .4).toBeCloseTo(scene.elements[0].y);
    expect(convertCanvasCoordinateSpace(converted, 'fullPage', .4).elements).toEqual(scene.elements);
  });

  it('validates IDs, geometry, assets, and clipping warnings', () => {
    const scene = defaultCanvasScene();
    scene.elements.push({ ...scene.elements[0], x: 6.9 });
    const issues = validateCanvasScene(scene);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: 'Duplicate canvas element ID: cover-rule' }),
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('will be clipped') })
    ]));
  });

  it('snaps to a sixteenth-inch grid unless bypassed', () => {
    expect(snapCanvasValue(.1)).toBe(.125);
    expect(snapCanvasValue(.1, true)).toBe(.1);
    expect(snapCanvasPosition(2.96, 1, 7)).toBe(3);
    expect(snapCanvasPosition(2.96, 1, 7, [], true)).toBe(2.96);
  });
});
