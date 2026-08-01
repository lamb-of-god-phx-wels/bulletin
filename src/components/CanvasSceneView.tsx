import type { CSSProperties, ReactNode } from 'react';
import { boundRichTextParagraphs, canvasLineMetrics, canvasSpace, canvasTextParagraphs } from '../shared/canvas.js';
import type { BulletinDocumentV1, CanvasElement, CanvasScene, Paragraph } from '../shared/types.js';

function InlineParagraph({ paragraph }: { paragraph: Paragraph }) {
  return <p style={{ textAlign: paragraph.align, lineHeight: paragraph.lineHeight }}>{paragraph.children.map((run, index) =>
    run.type === 'lineBreak'
      ? <br key={index} />
      : run.type === 'symbol'
        ? <span key={index}>✠</span>
        : <span className={run.marks?.map(mark => `mark-${mark}`).join(' ')} style={{ fontFamily: run.style?.fontFamily, fontSize: run.style?.fontSizePt ? `${run.style.fontSizePt}pt` : undefined, textTransform: run.style?.textTransform === 'uppercase' ? 'uppercase' : undefined, fontVariant: run.style?.textTransform === 'small-caps' ? 'small-caps' : undefined }} key={index}>{run.text}</span>
  )}</p>;
}

function geometry(element: CanvasElement): CSSProperties {
  return {
    left: `${element.x}in`,
    top: `${element.y}in`,
    width: `${element.width}in`,
    height: `${element.height}in`
  };
}

function textFontSize(element: Extract<CanvasElement, { type: 'text' }>, document: BulletinDocumentV1) {
  const requested = element.fontSizePt ?? 12;
  if (element.overflow !== 'shrinkToFit') return requested;
  const characters = canvasTextParagraphs(element, document)
    .flatMap(item => item.children)
    .reduce((total, run) => total + (run.type === 'text' ? run.text.length : 1), 0);
  const approximateCapacity = Math.max(1, element.width * element.height * 115 / Math.max(1, requested / 12));
  return Math.max(5, Math.min(requested, requested * Math.sqrt(approximateCapacity / Math.max(characters, 1))));
}

function CanvasLineView({ element }: {
  element: Extract<CanvasElement, { type: 'line' }> | (Extract<CanvasElement, { type: 'shape' }> & { shape: 'line' });
}) {
  const { length, rotationDeg } = canvasLineMetrics(element);
  const weight = element.widthPt ?? 1;
  const dash = element.dash === 'dashed'
    ? `${weight * 4}pt ${weight * 3}pt`
    : element.dash === 'dotted'
      ? `0 ${weight * 2.5}pt`
      : undefined;
  return <svg className="canvas-element canvas-line" data-canvas-element-id={element.id} aria-hidden="true" style={{
    left: `${element.x}in`,
    top: `${element.y}in`,
    width: `${length}in`,
    transform: `rotate(${rotationDeg}deg)`
  }}>
    <line x1="0" y1="0" x2="100%" y2="0" style={{
      stroke: element.color ?? '#25302d',
      strokeWidth: `${weight}pt`,
      strokeDasharray: dash,
      strokeLinecap: element.dash === 'dotted' ? 'round' : 'butt'
    }} />
  </svg>;
}

function CanvasElementView({ element, document, assets, renderNativeBlock }: {
  element: CanvasElement;
  document: BulletinDocumentV1;
  assets: Record<string, string>;
  renderNativeBlock?: (block: Extract<CanvasElement, { type: 'block' }>['block'], element: Extract<CanvasElement, { type: 'block' }>) => ReactNode;
}) {
  if (element.type === 'shape') {
    if (element.shape === 'line') return <CanvasLineView element={element as typeof element & { shape: 'line' }} />;
    return <div className="canvas-element canvas-rectangle" data-canvas-element-id={element.id} style={{
      ...geometry(element), background: element.fill ?? 'transparent',
      border: `${element.borderWidthPt ?? 0}pt solid ${element.borderColor ?? 'transparent'}`
    }} />;
  }
  if (element.type === 'block') {
    const native = element.block;
    const fallback = native.type === 'image'
      ? assets[native.asset.path] ? <img src={assets[native.asset.path]} alt={native.alt ?? native.asset.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: native.fit ?? 'contain' }} /> : <span className="canvas-missing-asset">Missing image</span>
      : native.type === 'richText'
        ? boundRichTextParagraphs(native, document).map((item, index) => <InlineParagraph paragraph={item} key={index} />)
        : 'text' in native ? native.text : native.label ?? (native.type === 'custom' ? native.name : native.type);
    const verticalAlign = native.presentation?.verticalAlign ?? element.verticalAlign;
    const vertical = verticalAlign === 'middle'
      ? 'center'
      : verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';
    return <div className={`canvas-element canvas-native-block ${element.sizing === 'autoHeight' ? 'auto-height' : 'fixed-height'}`} data-canvas-element-id={element.id} style={{
      ...geometry(element),
      height: element.sizing === 'autoHeight' ? 'auto' : `${element.height}in`,
      overflow: element.sizing === 'fixed' ? 'hidden' : undefined
    }}>{native.type === 'image'
      ? fallback
      : <div className="canvas-native-content" style={{
          display: 'flex',
          minHeight: 0,
          height: element.sizing === 'fixed' ? '100%' : 'auto',
          flexDirection: 'column',
          justifyContent: vertical
        }}>{renderNativeBlock?.(native, element) ?? fallback}</div>}</div>;
  }
  if (element.type === 'rectangle') return <div className="canvas-element canvas-rectangle" data-canvas-element-id={element.id} style={{
    ...geometry(element),
    background: element.fill ?? 'transparent',
    border: `${element.borderWidthPt ?? 0}pt solid ${element.borderColor ?? 'transparent'}`
  }} />;
  if (element.type === 'line') return <CanvasLineView element={element} />;
  if (element.type === 'image') return <div className="canvas-element canvas-image" data-canvas-element-id={element.id} style={geometry(element)}>
    {assets[element.asset.path]
      ? <img src={assets[element.asset.path]} alt={element.asset.alt ?? ''} style={{ objectFit: element.fit ?? 'contain' }} />
      : <span className="canvas-missing-asset">Missing image</span>}
  </div>;
  const padding = element.paddingIn ?? {};
  const style = {
    ...geometry(element),
    padding: `${padding.top ?? 0}in ${padding.right ?? 0}in ${padding.bottom ?? 0}in ${padding.left ?? 0}in`,
    fontFamily: element.fontFamily === 'body' ? 'var(--body-font)' : element.fontFamily === 'display' ? 'var(--display-font)' : element.fontFamily,
    fontSize: `${textFontSize(element, document)}pt`,
    lineHeight: element.lineHeight ?? 1.15,
    fontWeight: element.fontWeight,
    fontStyle: element.fontStyle,
    color: element.color,
    textAlign: element.textAlign,
    justifyContent: element.verticalAlign === 'middle' ? 'center' : element.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
    height: element.overflow === 'autoHeight' ? 'auto' : `${element.height}in`,
    overflow: element.overflow === 'fixed' ? 'hidden' : undefined
  } satisfies CSSProperties;
  return <div className="canvas-element canvas-text" data-canvas-element-id={element.id} style={style}>
    {canvasTextParagraphs(element, document).map((item, index) => <InlineParagraph paragraph={item} key={index} />)}
  </div>;
}

export function CanvasSceneView({ scene, document, assets, marginIn, widthIn = 7, heightIn = 8.5, renderNativeBlock }: {
  scene: CanvasScene;
  document: BulletinDocumentV1;
  assets: Record<string, string>;
  marginIn: number;
  widthIn?: number;
  heightIn?: number;
  renderNativeBlock?: (block: Extract<CanvasElement, { type: 'block' }>['block'], element: Extract<CanvasElement, { type: 'block' }>) => ReactNode;
}) {
  const space = canvasSpace(scene, marginIn, widthIn, heightIn);
  const background = scene.background;
  const pdfBackground = background?.asset?.mediaType === 'application/pdf';
  return <div
    className={`canvas-cover canvas-space-${scene.coordinateSpace} ${pdfBackground ? 'has-pdf-background' : ''}`}
    data-canvas-coordinate-space={scene.coordinateSpace}
    style={{
      left: `${space.x}in`,
      top: `${space.y}in`,
      width: `${space.width}in`,
      height: `${space.height}in`,
      backgroundColor: background?.color ?? 'transparent'
    }}
  >
    {background?.asset && (pdfBackground
      ? assets[background.asset.path] && <embed className="canvas-pdf-background" src={`${assets[background.asset.path]}#page=${background.asset.page ?? 1}&toolbar=0&navpanes=0`} type="application/pdf" />
      : assets[background.asset.path] && <img className="canvas-background-image" src={assets[background.asset.path]} alt={background.asset.alt ?? ''} style={{ objectFit: background.fit ?? 'cover' }} />)}
    <div className="canvas-elements">
      {scene.elements.map(element => <CanvasElementView element={element} document={document} assets={assets} renderNativeBlock={renderNativeBlock} key={element.id} />)}
    </div>
  </div>;
}
