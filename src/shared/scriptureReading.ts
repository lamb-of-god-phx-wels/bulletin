import type {
  BulletinBlock,
  CustomBlockStyle,
  Paragraph,
  RichTextBlock,
  ScriptureBlock,
  ScriptureElementRole
} from './types.js';

const text = (value: string): Paragraph[] => [{
  type: 'paragraph',
  children: [{ type: 'text', text: value }]
}];

export const scriptureElementOrder: ScriptureElementRole[] = ['heading', 'reference', 'caption', 'body'];

export const scriptureElementNames: Record<ScriptureElementRole, string> = {
  heading: 'Heading',
  reference: 'Scripture reference',
  caption: 'Caption',
  body: 'Body'
};

const defaultPresentation: Record<ScriptureElementRole, Partial<CustomBlockStyle>> = {
  heading: {
    widthPercent: 100,
    placement: 'left',
    textAlign: 'left',
    paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
    marginIn: { top: .2, bottom: .02 },
    fontFamily: 'body',
    fontSizePt: 10,
    lineHeight: 1.15,
    fontWeight: 'bold',
    fontStyle: 'normal',
    textTransform: 'uppercase',
    color: '#25302d'
  },
  reference: {
    widthPercent: 100,
    placement: 'left',
    textAlign: 'left',
    paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
    marginIn: { top: 0, bottom: .08 },
    fontFamily: 'body',
    fontSizePt: 10,
    lineHeight: 1.15,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textTransform: 'none',
    color: '#25302d'
  },
  caption: {
    widthPercent: 100,
    placement: 'left',
    textAlign: 'left',
    paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
    marginIn: { top: 0, bottom: .12 },
    fontFamily: 'body',
    fontSizePt: 10,
    lineHeight: 1.28,
    fontWeight: 'normal',
    fontStyle: 'italic',
    textTransform: 'none',
    color: '#25302d'
  },
  body: {
    widthPercent: 100,
    placement: 'left',
    textAlign: 'left',
    paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
    marginIn: { top: 0, bottom: 0 },
    fontFamily: 'body',
    fontSizePt: 10,
    lineHeight: 1.28,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textTransform: 'none',
    color: '#25302d'
  }
};

export function scriptureElementBlocks(block: ScriptureBlock): RichTextBlock[] {
  const content: Record<ScriptureElementRole, Paragraph[]> = {
    heading: block.elements?.heading?.content ?? text(block.label ?? ''),
    reference: block.elements?.reference?.content ?? text(block.reference),
    caption: block.elements?.caption?.content ?? text(block.caption ?? ''),
    body: block.resolved?.content ?? text('')
  };
  return scriptureElementOrder.map(scriptureRole => ({
    id: `${block.id}-${scriptureRole}`,
    type: 'richText',
    scriptureRole,
    content: content[scriptureRole],
    presentation: {
      ...defaultPresentation[scriptureRole],
      ...block.elements?.[scriptureRole]?.presentation,
      paddingIn: {
        ...defaultPresentation[scriptureRole].paddingIn!,
        ...block.elements?.[scriptureRole]?.presentation?.paddingIn
      },
      marginIn: {
        ...defaultPresentation[scriptureRole].marginIn!,
        ...block.elements?.[scriptureRole]?.presentation?.marginIn
      }
    },
    layout: block.elements?.[scriptureRole]?.layout
  }));
}

const plainText = (content: Paragraph[]) => content
  .map(paragraph => paragraph.children.map(child => child.type === 'text'
    ? child.text
    : child.type === 'lineBreak' ? '\n' : '✠').join(''))
  .join('\n\n');

export function updateScriptureElement(block: ScriptureBlock, element: RichTextBlock): ScriptureBlock {
  if (!element.scriptureRole) return block;
  const settings = {
    ...block.elements,
    [element.scriptureRole]: {
      presentation: element.presentation,
      layout: element.layout,
      content: element.content,
    }
  };
  const value = plainText(element.content);
  if (element.scriptureRole === 'heading') return { ...block, label: value || undefined, elements: settings };
  if (element.scriptureRole === 'reference') return { ...block, reference: value, resolved: undefined, elements: settings };
  if (element.scriptureRole === 'caption') return { ...block, caption: value || undefined, elements: settings };
  return {
    ...block,
    elements: settings,
    resolved: block.resolved
      ? { ...block.resolved, content: element.content }
      : {
        content: element.content,
        source: 'manual',
        retrievedAt: new Date().toISOString(),
        attribution: `${block.translation.toUpperCase()} — text supplied by user`
      }
  };
}

export function isScriptureElement(block: BulletinBlock): block is RichTextBlock & { scriptureRole: ScriptureElementRole } {
  return block.type === 'richText' && Boolean(block.scriptureRole);
}

export function scriptureElementHasContent(block: RichTextBlock): boolean {
  return block.content.some(paragraph => paragraph.children.some(child =>
    child.type === 'symbol' || child.type === 'lineBreak' || (child.type === 'text' && Boolean(child.text.trim()))
  ));
}
