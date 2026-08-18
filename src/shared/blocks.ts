import type { BulletinBlock, CustomBlockStyle, GroupBlock, Paragraph } from './types.js';
import { scriptureElementBlocks, updateScriptureElement } from './scriptureReading.js';

const text = (value: string): Paragraph[] => [{ type: 'paragraph', children: [{ type: 'text', text: value }] }];
const presentation = (changes: Partial<CustomBlockStyle>): Partial<CustomBlockStyle> => changes;
export function createLayoutContainer(layoutMode: NonNullable<GroupBlock['layoutMode']>, id: string): GroupBlock {
  const group: GroupBlock = {
    id,
    type: 'group',
    label: layoutMode === 'grid' ? 'Grid' : 'Table',
    layoutMode,
    columns: 2,
    rows: 2,
    gapIn: layoutMode === 'table' ? 0 : .12,
    ...(layoutMode === 'table' ? { tableShowLines: true } : {}),
    children: []
  };
  return layoutMode === 'table' ? ensureTableCells(group) : group;
}

export interface LayoutCell { row: number; column: number }

export function createTableCell(id: string): BulletinBlock {
  return { id, type: 'richText', content: text('') };
}

export function ensureTableCells(group: GroupBlock): GroupBlock {
  if (group.layoutMode !== 'table') return group;
  const columns = Math.max(1, Math.min(12, group.columns ?? 2));
  const rows = Math.max(1, Math.min(12, group.rows ?? 2));
  const existing = new Map(group.children.filter(child => child.type === 'richText').map((child, index) => {
    const cell = groupChildCell(group, child, index);
    return [`${cell.row}:${cell.column}`, child] as const;
  }));
  let changed = group.children.length !== rows * columns;
  const children = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = index % columns + 1;
    const child = existing.get(`${row}:${column}`) ?? createTableCell(`${group.id}-r${row}c${column}`);
    if (child.gridPosition?.row !== row || child.gridPosition?.column !== column) changed = true;
    return child.gridPosition?.row === row && child.gridPosition?.column === column ? child : { ...child, gridPosition: { row, column } } as BulletinBlock;
  });
  return changed ? { ...group, columns, rows, children } : group;
}

export function groupAcceptsChild(group: GroupBlock, child: BulletinBlock) {
  return group.layoutMode !== 'table' || child.type === 'richText';
}

export function groupChildCell(group: GroupBlock, child: BulletinBlock, index: number): LayoutCell {
  const columns = Math.max(1, Math.min(12, group.columns ?? 2));
  const row = child.gridPosition?.row;
  const column = child.gridPosition?.column;
  return Number.isInteger(row) && row! > 0 && Number.isInteger(column) && column! > 0
    ? { row: row!, column: column! }
    : { row: Math.floor(index / columns) + 1, column: index % columns + 1 };
}

export function placeGroupChild(group: GroupBlock, child: BulletinBlock, requested?: LayoutCell): GroupBlock {
  if (!groupAcceptsChild(group, child)) return group;
  const columns = Math.max(1, Math.min(12, group.columns ?? 2));
  let rows = Math.max(1, Math.min(12, group.rows ?? 2));
  const positioned = group.children.map((item, index) => ({ item, cell: groupChildCell(group, item, index) }));
  const occupied = new Set(positioned.map(({ cell }) => `${cell.row}:${cell.column}`));
  let cell = requested && requested.row <= rows && requested.column <= columns ? requested : undefined;
  let relocated: { id: string; cell: LayoutCell } | undefined;
  if (cell && occupied.has(`${cell.row}:${cell.column}`)) {
    const occupant = positioned.find(entry => entry.cell.row === cell!.row && entry.cell.column === cell!.column);
    let available: LayoutCell | undefined;
    for (let row = 1; row <= rows && !available; row += 1) for (let column = 1; column <= columns; column += 1) {
      if (!occupied.has(`${row}:${column}`)) { available = { row, column }; break; }
    }
    if (!available && rows < 12) { rows += 1; available = { row: rows, column: 1 }; }
    if (occupant && available) relocated = { id: occupant.item.id, cell: available };
  } else if (!cell) {
    cell = undefined;
    for (let row = 1; row <= rows && !cell; row += 1) for (let column = 1; column <= columns; column += 1) {
      if (!occupied.has(`${row}:${column}`)) { cell = { row, column }; break; }
    }
  }
  if (!cell) { rows = Math.min(12, rows + 1); cell = { row: rows, column: 1 }; }
  return { ...group, rows, children: [...positioned.map(({ item, cell: position }) => ({ ...item, gridPosition: relocated?.id === item.id ? relocated.cell : position } as BulletinBlock)), { ...child, gridPosition: cell } as BulletinBlock] };
}

export function moveGroupChildToCell(group: GroupBlock, childId: string, target: LayoutCell): GroupBlock {
  const positioned = group.children.map((item, index) => ({ item, cell: groupChildCell(group, item, index) }));
  const moving = positioned.find(entry => entry.item.id === childId);
  if (!moving) return group;
  const occupant = positioned.find(entry => entry.item.id !== childId && entry.cell.row === target.row && entry.cell.column === target.column);
  return {
    ...group,
    children: positioned.map(({ item, cell }) => ({
      ...item,
      gridPosition: item.id === childId ? target : occupant?.item.id === item.id ? moving.cell : cell
    } as BulletinBlock))
  };
}

export function moveGroupChildToRoot(blocks: BulletinBlock[], parentId: string, childId: string, targetId?: string, position: 'before' | 'after' = 'after'): BulletinBlock[] {
  const parent = findBlock(blocks, parentId);
  if (parent?.type !== 'group') return blocks;
  const child = parent.children.find(item => item.id === childId);
  if (!child) return blocks;
  const { gridPosition: _position, ...rootChild } = child;
  const withoutChild = updateBlockTree(blocks, parent.id, { ...parent, children: parent.children.filter(item => item.id !== child.id) });
  const ownerIndex = withoutChild.findIndex(block => Boolean(findBlock([block], parent.id)));
  const targetIndex = targetId ? withoutChild.findIndex(block => block.id === targetId) : -1;
  const insertionIndex = targetIndex >= 0 ? targetIndex + (position === 'after' ? 1 : 0) : Math.max(0, ownerIndex + 1);
  return [...withoutChild.slice(0, insertionIndex), rootChild as BulletinBlock, ...withoutChild.slice(insertionIndex)];
}

export function childBlocks(block: BulletinBlock): BulletinBlock[] | undefined {
  if (block.type === 'group') return block.children;
  if (block.type === 'templatePage') return block.blocks;
  if (block.type === 'templateInstance') return block.blocks;
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
