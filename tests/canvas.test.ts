import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canvasBindingText,
  canvasElementBounds,
  cloneCanvasSelection,
  convertCanvasCoordinateSpace,
  createCanvasBlock,
  defaultCanvasScene,
  normalizeCanvasScene,
  rotateCanvasLine,
  reorderCanvasElements,
  snapCanvasAxis,
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
    document.info.churchWeek = 'Ninth Sunday after Pentecost';
    expect(canvasBindingText('info.title', document)).toBe('The Good Shepherd');
    expect(canvasBindingText('info.churchEvent', document)).toBe('Ninth Sunday after Pentecost');
    expect(canvasBindingText('info.churchWeek', document)).toBe('Ninth Sunday after Pentecost');
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
    expect(snapCanvasAxis(2.96, 1, 7)).toEqual({ value: 3, guide: 3.5 });
    expect(snapCanvasAxis(2.96, 1, 7, [], true)).toEqual({ value: 2.96 });
  });

  it('moves layer selections without changing their internal order', () => {
    const elements: CanvasScene['elements'] = [
      { id: 'back', type: 'shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
      { id: 'middle-a', type: 'shape', shape: 'rectangle', x: 1, y: 0, width: 1, height: 1 },
      { id: 'middle-b', type: 'shape', shape: 'rectangle', x: 2, y: 0, width: 1, height: 1 },
      { id: 'front', type: 'shape', shape: 'rectangle', x: 3, y: 0, width: 1, height: 1 }
    ];
    const selected = new Set(['middle-a', 'middle-b']);
    expect(reorderCanvasElements(elements, selected, 'front').map(element => element.id)).toEqual(['back', 'front', 'middle-a', 'middle-b']);
    expect(reorderCanvasElements(elements, selected, 'back').map(element => element.id)).toEqual(['middle-a', 'middle-b', 'back', 'front']);
    expect(reorderCanvasElements(elements, selected, 'forward').map(element => element.id)).toEqual(['back', 'front', 'middle-a', 'middle-b']);
  });

  it('copies native canvas selections with fresh element, block, and group IDs', () => {
    const elements: CanvasScene['elements'] = [{
      id: 'heading',
      type: 'block',
      x: 1,
      y: 2,
      width: 3,
      height: .5,
      groupId: 'group-1',
      block: { id: 'heading-block', type: 'heading', text: 'Welcome' }
    }, {
      id: 'rule',
      type: 'shape',
      shape: 'line',
      x: 1,
      y: 2.6,
      width: 3,
      height: 0,
      groupId: 'group-1'
    }];
    const copies = cloneCanvasSelection(elements, new Set(elements.map(element => element.id)));
    expect(copies.map(element => element.id)).toEqual(['heading-copy', 'rule-copy']);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe('group-1');
    expect(copies[0]).toMatchObject({ x: 1.125, y: 2.125, block: { id: 'heading-block-copy' } });
    expect(canvasElementBounds(copies)).toMatchObject({ x: 1.125, y: 2.125, width: 3 });
    expect(canvasElementBounds(copies).height).toBeCloseTo(.6);
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
