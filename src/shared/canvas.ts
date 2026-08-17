import type {
  AssetRef,
  BulletinBlock,
  BulletinDocumentV1,
  CanvasBlock,
  CanvasElement,
  CanvasGeometry,
  CanvasScene,
  CanvasTextBinding,
  Paragraph,
  TemplateV1,
  LibraryManifestV1,
  ValidationIssue
} from './types.js';
import { flattenBlocks } from './blocks.js';
import { textBindingValue } from './customProperties.js';

export const CANVAS_PAGE = Object.freeze({ width: 7, height: 8.5 });
export const CANVAS_GRID_IN = 1 / 16;

export function createCanvasBlock(id: string, scene: CanvasScene = {
  schemaVersion: 2,
  coordinateSpace: 'fullPage',
  background: { color: '#ffffff' },
  elements: []
}): CanvasBlock {
  return {
    id,
    type: 'canvas',
    heightIn: CANVAS_PAGE.height,
    widthMode: 'fullPage',
    scene: structuredClone(scene)
  };
}

const paragraph = (text: string): Paragraph[] => [{
  type: 'paragraph',
  children: [{ type: 'text', text }]
}];

export function defaultCanvasScene(): CanvasScene {
  return normalizeCanvasScene({
    coordinateSpace: 'fullPage',
    background: { color: '#ffffff' },
    elements: [
      {
        id: 'cover-rule',
        name: 'Date rule',
        type: 'line',
        x: .4,
        y: .82,
        width: 6.2,
        height: 0,
        color: '#25302d',
        widthPt: 1,
        locked: true
      },
      {
        id: 'cover-week',
        name: 'Church event',
        type: 'text',
        x: .4,
        y: .47,
        width: 2.8,
        height: .28,
        source: { binding: 'info.churchEvent' },
        fontSizePt: 9,
        fontWeight: 'bold',
        overflow: 'shrinkToFit'
      },
      {
        id: 'cover-date',
        name: 'Service date',
        type: 'text',
        x: 3.8,
        y: .47,
        width: 2.8,
        height: .28,
        source: { binding: 'info.date', dateFormat: 'long' },
        fontSizePt: 9,
        textAlign: 'right',
        overflow: 'shrinkToFit'
      },
      {
        id: 'cover-series',
        name: 'Series',
        type: 'text',
        x: 1,
        y: 2,
        width: 5,
        height: 1.1,
        source: { binding: 'info.series', literal: paragraph('Worship') },
        fontFamily: 'display',
        fontSizePt: 39,
        color: '#a44d2a',
        textAlign: 'center',
        verticalAlign: 'middle',
        overflow: 'shrinkToFit'
      },
      {
        id: 'cover-title',
        name: 'Sermon title',
        type: 'text',
        x: 1,
        y: 3.45,
        width: 5,
        height: .75,
        source: { binding: 'info.title' },
        fontSizePt: 17,
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'middle',
        overflow: 'shrinkToFit'
      },
      {
        id: 'cover-church',
        name: 'Church name',
        type: 'text',
        x: .6,
        y: 7.72,
        width: 5.8,
        height: .35,
        source: { binding: 'church.name' },
        fontFamily: 'display',
        fontSizePt: 15,
        textAlign: 'center',
        overflow: 'shrinkToFit',
        locked: true
      }
    ]
  });
}

export function canvasNativeBlockAllowed(block: import('./types.js').BulletinBlock) {
  return !['canvas', 'templatePage', 'templateInstance', 'fullPageAsset', 'titlePage', 'canvasCover'].includes(block.type);
}

export function normalizeCanvasScene(scene: CanvasScene): CanvasScene {
  if (scene.schemaVersion === 2 && scene.elements.every(element => element.type === 'block' || element.type === 'shape')) return {
    ...scene,
    elements: scene.elements.map(element => element.type === 'block'
      ? { ...element, verticalAlign: element.block.presentation?.verticalAlign ?? element.verticalAlign }
      : element)
  };
  return {
    ...scene,
    schemaVersion: 2,
    elements: scene.elements.map(element => {
      if (element.type === 'block' || element.type === 'shape') return element;
      const base = {
        id: element.id,
        name: element.name,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        locked: element.locked,
        groupId: element.groupId
      };
      if (element.type === 'rectangle') {
        return { ...base, type: 'shape' as const, shape: 'rectangle' as const, fill: element.fill, borderColor: element.borderColor, borderWidthPt: element.borderWidthPt };
      }
      if (element.type === 'line') {
        return { ...base, type: 'shape' as const, shape: 'line' as const, color: element.color, widthPt: element.widthPt, dash: element.dash, rotationDeg: element.rotationDeg };
      }
      if (element.type === 'image') {
        return {
          ...base,
          type: 'block' as const,
          sizing: 'fixed' as const,
          block: { id: `${element.id}-image`, type: 'image' as const, asset: structuredClone(element.asset), fit: element.fit, heightIn: element.height, alt: element.asset.alt }
        };
      }
      return {
        ...base,
        type: 'block' as const,
        sizing: element.overflow === 'autoHeight' || !element.overflow ? 'autoHeight' as const : 'fixed' as const,
        verticalAlign: element.verticalAlign,
        block: {
          id: `${element.id}-text`,
          type: 'richText' as const,
          content: structuredClone(element.source.literal ?? paragraph('')),
          binding: element.source.binding,
          bindingOverride: structuredClone(element.source.override),
          dateFormat: element.source.dateFormat,
          presentation: {
            widthPercent: 100,
            paddingIn: { top: element.paddingIn?.top ?? 0, right: element.paddingIn?.right ?? 0, bottom: element.paddingIn?.bottom ?? 0, left: element.paddingIn?.left ?? 0 },
            marginIn: { top: 0, bottom: 0 },
            fontFamily: element.fontFamily ?? 'body',
            fontSizePt: element.fontSizePt ?? 12,
            lineHeight: element.lineHeight ?? 1.15,
            fontWeight: element.fontWeight === 'bold' ? 'bold' : 'normal',
            fontStyle: element.fontStyle ?? 'normal',
            textAlign: element.textAlign ?? 'left',
            color: element.color ?? '#25302d'
          }
        }
      };
    })
  };
}

export function canvasSpace(scene: CanvasScene, marginIn: number, widthIn: number = CANVAS_PAGE.width, heightIn: number = CANVAS_PAGE.height) {
  return scene.coordinateSpace === 'fullPage'
    ? { x: 0, y: 0, width: widthIn, height: heightIn }
    : {
        x: marginIn,
        y: marginIn,
        width: widthIn - marginIn * 2,
        height: heightIn - marginIn * 2
      };
}

export function convertCanvasCoordinateSpace(scene: CanvasScene, next: CanvasScene['coordinateSpace'], marginIn: number): CanvasScene {
  if (scene.coordinateSpace === next) return scene;
  const offset = next === 'contentBox' ? -marginIn : marginIn;
  return {
    ...scene,
    coordinateSpace: next,
    elements: scene.elements.map(element => ({ ...element, x: element.x + offset, y: element.y + offset }))
  };
}

export function snapCanvasValue(value: number, bypass = false) {
  return bypass ? value : Math.round(value / CANVAS_GRID_IN) * CANVAS_GRID_IN;
}

export interface CanvasSnapResult {
  value: number;
  guide?: number;
}

export function snapCanvasAxis(
  value: number,
  size: number,
  extent: number,
  targetLines: number[] = [],
  bypass = false
): CanvasSnapResult {
  if (bypass) return { value };
  const lines = [...new Set([0, extent / 2, extent, ...targetLines].filter(Number.isFinite))];
  const candidates = lines.flatMap(guide => [
    { value: guide, guide },
    { value: guide - size / 2, guide },
    { value: guide - size, guide }
  ]);
  const nearest = candidates.reduce<{ value: number; guide: number } | undefined>((best, candidate) =>
    !best || Math.abs(candidate.value - value) < Math.abs(best.value - value) ? candidate : best, undefined);
  return nearest && Math.abs(nearest.value - value) <= .08
    ? nearest
    : { value: snapCanvasValue(value) };
}

export function snapCanvasPosition(value: number, size: number, extent: number, nearbyEdges: number[] = [], bypass = false) {
  return snapCanvasAxis(value, size, extent, nearbyEdges, bypass).value;
}

export function canvasElementBounds(elements: CanvasElement[]) {
  if (!elements.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...elements.map(element => element.x));
  const y = Math.min(...elements.map(element => element.y));
  const right = Math.max(...elements.map(element => element.x + element.width));
  const bottom = Math.max(...elements.map(element => element.y + Math.max(0, element.height)));
  return { x, y, width: right - x, height: bottom - y };
}

export type CanvasResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export function resizeCanvasGeometry<T extends CanvasGeometry>(
  element: T,
  corner: CanvasResizeCorner,
  dx: number,
  dy: number,
  extentWidth: number,
  extentHeight: number,
  minimumWidth = 1 / 16,
  minimumHeight = 1 / 16,
): T {
  const originalRight = element.x + element.width;
  const originalBottom = element.y + element.height;
  const west = corner.endsWith('w');
  const north = corner.startsWith('n');
  const left = west
    ? Math.max(0, Math.min(originalRight - minimumWidth, element.x + dx))
    : element.x;
  const right = west
    ? originalRight
    : Math.max(left + minimumWidth, Math.min(extentWidth, originalRight + dx));
  const top = north
    ? Math.max(0, Math.min(originalBottom - minimumHeight, element.y + dy))
    : element.y;
  const bottom = north
    ? originalBottom
    : Math.max(top + minimumHeight, Math.min(extentHeight, originalBottom + dy));
  return { ...element, x: left, y: top, width: right - left, height: bottom - top };
}

export type CanvasLayerAction = 'front' | 'forward' | 'backward' | 'back';

export function reorderCanvasElements(elements: CanvasElement[], selectedIds: Set<string>, action: CanvasLayerAction) {
  if (!selectedIds.size) return elements;
  if (action === 'front') return [
    ...elements.filter(element => !selectedIds.has(element.id)),
    ...elements.filter(element => selectedIds.has(element.id))
  ];
  if (action === 'back') return [
    ...elements.filter(element => selectedIds.has(element.id)),
    ...elements.filter(element => !selectedIds.has(element.id))
  ];
  const next = [...elements];
  if (action === 'forward') {
    for (let index = next.length - 2; index >= 0; index--) {
      if (selectedIds.has(next[index].id) && !selectedIds.has(next[index + 1].id)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index++) {
      if (selectedIds.has(next[index].id) && !selectedIds.has(next[index - 1].id)) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }
  return next;
}

const freshCopyId = (source: string, used: Set<string>) => {
  const base = `${source}-copy`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
};

function cloneCanvasBlock(block: BulletinBlock, used: Set<string>): BulletinBlock {
  const next = { ...structuredClone(block), id: freshCopyId(block.id, used) } as BulletinBlock;
  if (next.type === 'group' || next.type === 'churchInfo') {
    next.children = next.children?.map(child => cloneCanvasBlock(child, used));
  }
  if (next.type === 'paragraph') {
    next.children = next.children.map(child => cloneCanvasBlock(child, used) as typeof child);
  }
  return next;
}

export function cloneCanvasSelection(
  elements: CanvasElement[],
  selectedIds: Set<string>,
  offset = .125,
  existingElements: CanvasElement[] = elements
) {
  const usedElementIds = new Set(existingElements.map(element => element.id));
  const usedBlockIds = new Set(flattenBlocks(existingElements.flatMap(element => element.type === 'block' ? [element.block] : [])).map(block => block.id));
  const groupIds = new Map<string, string>();
  return elements.filter(element => selectedIds.has(element.id)).map(element => {
    const next = {
      ...structuredClone(element),
      id: freshCopyId(element.id, usedElementIds),
      x: element.x + offset,
      y: element.y + offset
    } as CanvasElement;
    if (element.groupId) {
      let groupId = groupIds.get(element.groupId);
      if (!groupId) {
        groupId = `${element.groupId}-copy-${groupIds.size + 1}`;
        groupIds.set(element.groupId, groupId);
      }
      next.groupId = groupId;
    }
    if (next.type === 'block') next.block = cloneCanvasBlock(next.block, usedBlockIds);
    return next;
  });
}

export function canvasLineMetrics(element: CanvasGeometry & { rotationDeg?: number }) {
  const explicitRotation = Number.isFinite(element.rotationDeg);
  return {
    length: explicitRotation ? element.width : Math.hypot(element.width, element.height),
    rotationDeg: explicitRotation ? element.rotationDeg! : Math.atan2(element.height, element.width) * 180 / Math.PI
  };
}

export function rotateCanvasLine<T extends CanvasGeometry & { rotationDeg?: number }>(element: T, rotationDeg: number): T {
  const normalized = ((rotationDeg % 360) + 360) % 360;
  return { ...element, width: canvasLineMetrics(element).length, height: 0, rotationDeg: normalized };
}

export function canvasBindingText(binding: CanvasTextBinding, document: BulletinDocumentV1, dateFormat: 'long' | 'medium' | 'short' | 'iso' = 'long', template?: TemplateV1): string {
  return textBindingValue(binding, document, template, dateFormat);
}

export function boundRichTextParagraphs(block: Extract<import('./types.js').BulletinBlock, { type: 'richText' }>, document: BulletinDocumentV1, template?: TemplateV1, library?: LibraryManifestV1): Paragraph[] {
  if (block.bindingOverride) return block.bindingOverride;
  if (!block.binding) return block.content;
  const binding = block.binding;
  let content: Paragraph[];
  if (typeof binding === 'object' && binding.kind === 'libraryItem') {
    content = library?.items.filter(item => item.id === binding.itemId && (!binding.version || item.version === binding.version)).sort((left, right) => right.version - left.version)[0]?.content ?? block.content;
  } else {
    const value = canvasBindingText(binding, document, block.dateFormat, template);
    content = value ? paragraph(value) : block.content;
  }
  return block.bindingFormatting ? applyRichTextFormatting(block.bindingFormatting, content) : content;
}

export function applyRichTextFormatting(formatting: Paragraph[], content: Paragraph[]): Paragraph[] {
  if (!formatting.length) return content;
  return content.map((paragraph, index) => {
    const format = formatting[Math.min(index, formatting.length - 1)];
    const textFormats = format.children.filter((child): child is Extract<typeof child, { type: 'text' }> => child.type === 'text');
    let textIndex = 0;
    return {
      ...paragraph,
      align: format.align,
      lineHeight: format.lineHeight,
      breakBefore: format.breakBefore,
      children: paragraph.children.map(child => {
        if (child.type !== 'text') return child;
        const source = textFormats[Math.min(textIndex++, Math.max(0, textFormats.length - 1))];
        if (!source) return child;
        return { ...child, marks: source.marks, style: source.style };
      })
    };
  });
}

export function resetBoundRichTextContent(block: Extract<import('./types.js').BulletinBlock, { type: 'richText' }>): Extract<import('./types.js').BulletinBlock, { type: 'richText' }> {
  if (!block.bindingOverride) return block;
  const { bindingOverride, ...next } = block;
  return { ...next, bindingFormatting: structuredClone(bindingOverride) };
}

export function canvasTextParagraphs(element: Extract<CanvasElement, { type: 'text' }>, document: BulletinDocumentV1, template?: TemplateV1): Paragraph[] {
  if (element.source.override) return element.source.override;
  if (element.source.binding) {
    const value = canvasBindingText(element.source.binding, document, element.source.dateFormat, template);
    if (value) return paragraph(value);
  }
  return element.source.literal ?? paragraph('');
}

export function canvasAssetRefs(scene: CanvasScene): AssetRef[] {
  return [
    ...(scene.background?.asset ? [scene.background.asset] : []),
    ...scene.elements.flatMap(element => {
      if (element.type === 'image') return [element.asset];
      if (element.type !== 'block') return [];
      const block = element.block;
      if ('asset' in block && block.asset) return [block.asset];
      if (block.type === 'churchInfo' && block.heroAsset) return [block.heroAsset];
      if (block.type === 'announcements') return block.items.flatMap(item => item.asset ? [item.asset] : []);
      if (block.type === 'list') return block.items.flatMap(item => item.asset ? [item.asset] : []);
      return [];
    })
  ];
}

export const canvasNativeBlocks = (scene: CanvasScene) =>
  normalizeCanvasScene(scene).elements.flatMap(element => element.type === 'block' ? [element.block] : []);

export function normalizeCanvasBlocks(blocks: import('./types.js').BulletinBlock[]): import('./types.js').BulletinBlock[] {
  return blocks.map(block => {
    if (block.type === 'canvas') return { ...block, scene: normalizeCanvasScene(block.scene) };
    if (block.type === 'templatePage') return { ...block, blocks: normalizeCanvasBlocks(block.blocks) };
    if (block.type === 'templateInstance') return { ...block, blocks: normalizeCanvasBlocks(block.blocks) };
    if (block.type === 'group') return { ...block, children: normalizeCanvasBlocks(block.children) };
    if (block.type === 'churchInfo') return { ...block, children: block.children ? normalizeCanvasBlocks(block.children) : block.children };
    if (block.type === 'paragraph') return { ...block, children: normalizeCanvasBlocks(block.children) as typeof block.children };
    return block;
  });
}

function finiteGeometry(value: CanvasGeometry) {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite);
}

export interface CanvasSceneIssue extends ValidationIssue {
  severity: 'error' | 'warning';
}

export function validateCanvasScene(scene: CanvasScene, marginIn = .4, basePath = '/scene', widthIn: number = CANVAS_PAGE.width, heightIn: number = CANVAS_PAGE.height): CanvasSceneIssue[] {
  const issues: CanvasSceneIssue[] = [];
  if (!scene || typeof scene !== 'object') return [{ path: basePath, message: 'Canvas scene must be an object.', severity: 'error' }];
  if (scene.coordinateSpace !== 'fullPage' && scene.coordinateSpace !== 'contentBox') {
    issues.push({ path: `${basePath}/coordinateSpace`, message: 'Choose fullPage or contentBox coordinates.', severity: 'error' });
    return issues;
  }
  if (!Array.isArray(scene.elements)) {
    issues.push({ path: `${basePath}/elements`, message: 'Canvas elements must be an array.', severity: 'error' });
    return issues;
  }
  const ids = new Set<string>();
  const space = canvasSpace(scene, marginIn, widthIn, heightIn);
  scene.elements.forEach((element, index) => {
    const path = `${basePath}/elements/${index}`;
    if (!element || typeof element !== 'object') {
      issues.push({ path, message: 'Canvas element must be an object.', severity: 'error' });
      return;
    }
    if (!['block', 'shape', 'text', 'image', 'rectangle', 'line'].includes(element.type)) {
      issues.push({ path: `${path}/type`, message: `Unsupported canvas element type: ${String(element.type)}`, severity: 'error' });
    }
    if (!element.id) issues.push({ path: `${path}/id`, message: 'Every canvas element needs a stable ID.', severity: 'error' });
    else if (ids.has(element.id)) issues.push({ path: `${path}/id`, message: `Duplicate canvas element ID: ${element.id}`, severity: 'error' });
    ids.add(element.id);
    if (!finiteGeometry(element)) issues.push({ path, message: 'Canvas geometry must contain finite numbers.', severity: 'error' });
    const positiveHeight = element.type === 'line' || (element.type === 'shape' && element.shape === 'line') ? element.height >= 0 : element.height > 0;
    if (!(element.width > 0) || !positiveHeight) issues.push({ path, message: 'Canvas elements need a positive width and height.', severity: 'error' });
    if (element.type === 'image' && (!element.asset.path || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(element.asset.mediaType))) {
      issues.push({ path: `${path}/asset`, message: 'Canvas images require a PNG, JPEG, or SVG asset.', severity: 'error' });
    }
    if (element.type === 'block' && !canvasNativeBlockAllowed(element.block)) {
      issues.push({ path: `${path}/block/type`, message: `The ${element.block.type} block cannot be nested inside a canvas.`, severity: 'error' });
    }
    if (element.type === 'text' && element.source.binding && typeof element.source.binding === 'string' && !['info.title', 'info.date', 'info.churchWeek', 'info.churchEvent', 'info.series', 'church.name'].includes(element.source.binding)) {
      issues.push({ path: `${path}/source/binding`, message: `Unsupported canvas binding: ${element.source.binding}`, severity: 'error' });
    }
    const isLine = element.type === 'line' || (element.type === 'shape' && element.shape === 'line');
    if (isLine && element.widthPt !== undefined && (!(element.widthPt > 0) || !Number.isFinite(element.widthPt))) {
      issues.push({ path: `${path}/widthPt`, message: 'Line weight must be a positive finite number.', severity: 'error' });
    }
    if (isLine && element.rotationDeg !== undefined && !Number.isFinite(element.rotationDeg)) {
      issues.push({ path: `${path}/rotationDeg`, message: 'Line rotation must be a finite number.', severity: 'error' });
    }
    const bounds = isLine && finiteGeometry(element)
      ? (() => {
          const metrics = canvasLineMetrics(element);
          const radians = metrics.rotationDeg * Math.PI / 180;
          const endX = element.x + Math.cos(radians) * metrics.length;
          const endY = element.y + Math.sin(radians) * metrics.length;
          return { left: Math.min(element.x, endX), top: Math.min(element.y, endY), right: Math.max(element.x, endX), bottom: Math.max(element.y, endY) };
        })()
      : { left: element.x, top: element.y, right: element.x + element.width, bottom: element.y + element.height };
    if (finiteGeometry(element) && (bounds.left < 0 || bounds.top < 0 || bounds.right > space.width || bounds.bottom > space.height)) {
      issues.push({ path, message: `Element “${element.name ?? element.id}” extends outside the ${scene.coordinateSpace} and will be clipped.`, severity: 'warning' });
    }
  });
  if (scene.background?.asset && !scene.background.asset.path) {
    issues.push({ path: `${basePath}/background/asset/path`, message: 'Canvas background asset path is required.', severity: 'error' });
  }
  if (scene.background?.asset && !['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'].includes(scene.background.asset.mediaType)) {
    issues.push({ path: `${basePath}/background/asset/mediaType`, message: 'Canvas backgrounds support PNG, JPEG, SVG, or PDF assets.', severity: 'error' });
  }
  return issues;
}
