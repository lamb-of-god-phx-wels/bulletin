import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canvasBindingText,
  convertCanvasCoordinateSpace,
  createCanvasBlock,
  defaultCanvasScene,
  normalizeCanvasScene,
  rotateCanvasLine,
  snapCanvasValue,
  snapCanvasPosition,
  validateCanvasScene
} from '../src/shared/canvas';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { CanvasSceneView } from '../src/components/CanvasSceneView';
import type { CanvasScene } from '../src/shared/types';

describe('canvas cover scenes', () => {
  it('creates canvases at the full physical page size', () => {
    expect(createCanvasBlock('new-canvas')).toMatchObject({
      id: 'new-canvas',
      type: 'canvas',
      heightIn: 8.5,
      widthMode: 'fullPage',
      scene: { coordinateSpace: 'fullPage' }
    });
  });

  it('migrates legacy canvas primitives to native blocks and shapes without moving them', () => {
    const migrated = normalizeCanvasScene({
      coordinateSpace: 'fullPage',
      elements: [
        { id: 'copy', type: 'text', x: 1, y: 2, width: 3, height: .5, source: { binding: 'info.title' }, verticalAlign: 'bottom' },
        { id: 'rule', type: 'line', x: .5, y: 3, width: 6, height: 0, widthPt: 1 }
      ]
    });
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      elements: [
        { id: 'copy', type: 'block', x: 1, y: 2, width: 3, verticalAlign: 'bottom', block: { type: 'richText', binding: 'info.title' } },
        { id: 'rule', type: 'shape', shape: 'line', x: .5, y: 3, width: 6 }
      ]
    });
  });

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

  it('rotates lines explicitly while preserving their length', () => {
    expect(rotateCanvasLine({ x: 1, y: 1, width: 3, height: 4 }, 270)).toEqual({
      x: 1,
      y: 1,
      width: 5,
      height: 0,
      rotationDeg: 270
    });
    const scene: CanvasScene = {
      schemaVersion: 2,
      coordinateSpace: 'fullPage',
      elements: [{ id: 'rule', type: 'shape', shape: 'line', x: .2, y: 1, width: 1, height: 0, rotationDeg: 180, widthPt: 0 }]
    };
    expect(validateCanvasScene(scene)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/scene/elements/0/widthPt', message: expect.stringContaining('positive') }),
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('will be clipped') })
    ]));
    scene.elements[0] = { id: 'rule', type: 'shape', shape: 'line', x: 1, y: 1, width: 1, height: 0, rotationDeg: 45, widthPt: 1.25 };
    const markup = renderToStaticMarkup(createElement(CanvasSceneView, {
      scene,
      document: createBulletin(defaultTemplate),
      assets: {},
      marginIn: 0
    }));
    expect(markup).toContain('<svg');
    expect(markup).toContain('stroke-width:1.25pt');
    expect(markup).not.toContain('border-top');
  });

  it('sizes native images from their live canvas box', () => {
    const scene: CanvasScene = {
      schemaVersion: 2,
      coordinateSpace: 'fullPage',
      elements: [{
        id: 'image',
        type: 'block',
        x: 1,
        y: 1,
        width: 3,
        height: 1.5,
        sizing: 'fixed',
        block: {
          id: 'native-image',
          type: 'image',
          asset: { path: 'cover.svg', mediaType: 'image/svg+xml' },
          fit: 'cover',
          heightIn: .75
        }
      }]
    };
    const markup = renderToStaticMarkup(createElement(CanvasSceneView, {
      scene,
      document: createBulletin(defaultTemplate),
      assets: { 'cover.svg': 'data:image/svg+xml;base64,PHN2Zy8+' },
      marginIn: 0,
      renderNativeBlock: () => createElement('span', null, 'stale native image sizing')
    }));
    expect(markup).toContain('height:1.5in');
    expect(markup).toContain('width:100%;height:100%;object-fit:cover');
    expect(markup).not.toContain('stale native image sizing');
  });
});
