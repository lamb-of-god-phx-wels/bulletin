import type {
  AssetRef,
  BulletinDocumentV1,
  CanvasBlock,
  CanvasElement,
  CanvasGeometry,
  CanvasScene,
  CanvasTextBinding,
  Paragraph,
  ValidationIssue
} from './types.js';

export const CANVAS_PAGE = Object.freeze({ width: 7, height: 8.5 });
export const CANVAS_GRID_IN = 1 / 16;

export function createCanvasBlock(id: string, scene: CanvasScene = {
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
  return {
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
        name: 'Church week',
        type: 'text',
        x: .4,
        y: .47,
        width: 2.8,
        height: .28,
        source: { binding: 'info.churchWeek' },
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

export function snapCanvasPosition(value: number, size: number, extent: number, nearbyEdges: number[] = [], bypass = false) {
  if (bypass) return value;
  const grid = snapCanvasValue(value);
  const targets = [0, extent - size, (extent - size) / 2, ...nearbyEdges.flatMap(edge => [edge, edge - size, edge - size / 2])];
  const nearest = targets.reduce((best, target) => Math.abs(target - value) < Math.abs(best - value) ? target : best, targets[0]);
  return Math.abs(nearest - value) <= .08 ? nearest : grid;
}

export function canvasBindingText(binding: CanvasTextBinding, document: BulletinDocumentV1, dateFormat: 'long' | 'medium' | 'short' | 'iso' = 'long'): string {
  if (binding === 'church.name') return document.church.name;
  if (binding === 'info.title') return document.info.title;
  if (binding === 'info.series') return document.info.series ?? '';
  if (binding === 'info.churchWeek') return document.info.churchWeek;
  if (dateFormat === 'iso') return document.info.date;
  const date = new Date(`${document.info.date}T12:00:00Z`);
  const options: Intl.DateTimeFormatOptions = dateFormat === 'short'
    ? { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }
    : dateFormat === 'medium'
      ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
      : { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function boundRichTextParagraphs(block: Extract<import('./types.js').BulletinBlock, { type: 'richText' }>, document: BulletinDocumentV1): Paragraph[] {
  if (block.bindingOverride) return block.bindingOverride;
  if (!block.binding) return block.content;
  const value = canvasBindingText(block.binding, document, block.dateFormat);
  return value ? paragraph(value) : block.content;
}

export function canvasTextParagraphs(element: Extract<CanvasElement, { type: 'text' }>, document: BulletinDocumentV1): Paragraph[] {
  if (element.source.override) return element.source.override;
  if (element.source.binding) {
    const value = canvasBindingText(element.source.binding, document, element.source.dateFormat);
    if (value) return paragraph(value);
  }
  return element.source.literal ?? paragraph('');
}

export function canvasAssetRefs(scene: CanvasScene): AssetRef[] {
  return [
    ...(scene.background?.asset ? [scene.background.asset] : []),
    ...scene.elements.flatMap(element => element.type === 'image' ? [element.asset] : [])
  ];
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
    if (!['text', 'image', 'rectangle', 'line'].includes(element.type)) {
      issues.push({ path: `${path}/type`, message: `Unsupported canvas element type: ${String(element.type)}`, severity: 'error' });
    }
    if (!element.id) issues.push({ path: `${path}/id`, message: 'Every canvas element needs a stable ID.', severity: 'error' });
    else if (ids.has(element.id)) issues.push({ path: `${path}/id`, message: `Duplicate canvas element ID: ${element.id}`, severity: 'error' });
    ids.add(element.id);
    if (!finiteGeometry(element)) issues.push({ path, message: 'Canvas geometry must contain finite numbers.', severity: 'error' });
    const positiveHeight = element.type === 'line' ? element.height >= 0 : element.height > 0;
    if (!(element.width > 0) || !positiveHeight) issues.push({ path, message: 'Canvas elements need a positive width and height.', severity: 'error' });
    if (element.type === 'image' && (!element.asset.path || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(element.asset.mediaType))) {
      issues.push({ path: `${path}/asset`, message: 'Canvas images require a PNG, JPEG, or SVG asset.', severity: 'error' });
    }
    if (element.type === 'text' && element.source.binding && !['info.title', 'info.date', 'info.churchWeek', 'info.series', 'church.name'].includes(element.source.binding)) {
      issues.push({ path: `${path}/source/binding`, message: `Unsupported canvas binding: ${element.source.binding}`, severity: 'error' });
    }
    if (finiteGeometry(element) && (element.x < 0 || element.y < 0 || element.x + element.width > space.width || element.y + element.height > space.height)) {
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
