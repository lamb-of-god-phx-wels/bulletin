import type { BulletinBlock, ChurchInfoBlock, CustomBlockStyle, GroupBlock, Paragraph } from './types.js';
import { scriptureElementBlocks, updateScriptureElement } from './scriptureReading.js';

const text = (value: string): Paragraph[] => [{ type: 'paragraph', children: [{ type: 'text', text: value }] }];
const presentation = (changes: Partial<CustomBlockStyle>): Partial<CustomBlockStyle> => changes;
const paragraph = (id: string, header: string | undefined, body: string, blockPresentation?: Partial<CustomBlockStyle>): BulletinBlock => ({
  id, type: 'paragraph', presentation: blockPresentation, children: [
    ...(header ? [{ id: `${id}-header`, type: 'richText' as const, role: 'header' as const, content: text(header), presentation: presentation({ fontWeight: 'bold', textTransform: 'uppercase', marginIn: { top: 0, bottom: .035 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } }) }] : []),
    { id: `${id}-body`, type: 'richText', role: 'body', content: text(body), presentation: presentation({ marginIn: { top: 0, bottom: 0 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } }) }
  ]
});

export function defaultChurchInfoChildren(): BulletinBlock[] {
  return [
    paragraph('church-tagline', undefined, 'Reaching Up. Reaching Out. Reaching Across.', presentation({ fontStyle: 'italic', color: '#696d68', marginIn: { top: 0, bottom: .18 } })),
    paragraph('church-welcome', 'Welcome', 'Thank you for joining us for worship. We gather before our almighty God to offer him our worship and praise and to strengthen ourselves through his holy and powerful Word.'),
    paragraph('church-children', 'Children’s Room', 'Children are always welcome in worship. A children’s room is available for families who need it.'),
    paragraph('church-contact', undefined, 'Church information is maintained in the shared content library.', presentation({ textAlign: 'center', paddingIn: { top: .25, right: .25, bottom: .25, left: .25 }, marginIn: { top: .4, bottom: 0 }, borderWidthPt: 1, borderColor: '#d8d4cb' }))
  ];
}

export function createLayoutContainer(layoutMode: NonNullable<GroupBlock['layoutMode']>, id: string): GroupBlock {
  const count = layoutMode === 'stack' ? 1 : 2;
  return {
    id,
    type: 'group',
    label: layoutMode === 'stack' ? 'Stack' : layoutMode === 'grid' ? 'Grid' : 'Table',
    layoutMode,
    columns: layoutMode === 'stack' ? 1 : 2,
    gapIn: layoutMode === 'table' ? 0 : .12,
    children: Array.from({ length: count }, (_, index) => paragraph(
      `${id}-item-${index + 1}`,
      undefined,
      layoutMode === 'table' ? `Cell ${index + 1}` : `Item ${index + 1}`
    ))
  };
}

export function childBlocks(block: BulletinBlock): BulletinBlock[] | undefined {
  if (block.type === 'group') return block.children;
  if (block.type === 'templatePage') return block.blocks;
  if (block.type === 'templateInstance') return block.blocks;
  if (block.type === 'churchInfo') return block.children ?? defaultChurchInfoChildren();
  if (block.type === 'paragraph') {
    if (Array.isArray(block.children)) return block.children;
    const legacy = block as unknown as { id: string; header?: string; content?: Paragraph[] };
    return [
      ...(legacy.header ? [{ id: `${block.id}-header`, type: 'richText' as const, role: 'header' as const, content: text(legacy.header), presentation: presentation({ fontWeight: 'bold', marginIn: { top: 0, bottom: 0 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } }) }] : []),
      { id: `${block.id}-body`, type: 'richText', role: 'body', content: legacy.content ?? text(''), presentation: presentation({ marginIn: { top: 0, bottom: 0 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } }) }
    ];
  }
  if (block.type === 'scriptureReading') return scriptureElementBlocks(block);
  return undefined;
}

export function flattenBlocks(blocks: BulletinBlock[]): BulletinBlock[] {
  return blocks.flatMap(block => [block, ...(childBlocks(block) ? flattenBlocks(childBlocks(block)!) : [])]);
}

export function findBlock(blocks: BulletinBlock[], id: string): BulletinBlock | undefined {
  return flattenBlocks(blocks).find(block => block.id === id);
}

export function updateBlockTree(blocks: BulletinBlock[], id: string, next: BulletinBlock): BulletinBlock[] {
  return blocks.map(block => {
    if (block.id === id) return next;
    const children = childBlocks(block);
    if (!children?.some(child => findBlock([child], id))) return block;
    const updatedChildren = updateBlockTree(children, id, next);
    if (block.type === 'churchInfo') return { ...block, children: updatedChildren } satisfies ChurchInfoBlock;
    if (block.type === 'group') return { ...block, children: updatedChildren };
    if (block.type === 'templatePage') return { ...block, blocks: updatedChildren };
    if (block.type === 'templateInstance') return { ...block, blocks: updatedChildren };
    if (block.type === 'paragraph') return { ...block, children: updatedChildren.filter(child => child.type === 'richText') };
    if (block.type === 'scriptureReading') {
      const element = updatedChildren.find(child => child.id === id);
      return element?.type === 'richText' ? updateScriptureElement(block, element) : block;
    }
    return block;
  });
}
