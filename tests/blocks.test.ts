import { describe, expect, it } from 'vitest';
import { childBlocks, defaultChurchInfoChildren, findBlock, flattenBlocks, updateBlockTree } from '../src/shared/blocks';
import type { BulletinBlock } from '../src/shared/types';

describe('nested blocks', () => {
  it('materializes church information as independently typed elements', () => {
    const church: BulletinBlock = { id: 'church', type: 'churchInfo' };
    const children = childBlocks(church)!;
    expect(children.map(block => block.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(findBlock([church], 'church-welcome-header')).toMatchObject({ type: 'richText', role: 'header', content: [{ children: [{ text: 'Welcome' }] }] });
  });

  it('updates one nested element without flattening siblings or formatting', () => {
    const children = defaultChurchInfoChildren();
    const church: BulletinBlock = { id: 'church', type: 'churchInfo', children };
    const header = findBlock([church], 'church-welcome-header')!;
    const updated = updateBlockTree([church], header.id, { ...header, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Welcome to Worship' }] }], presentation: { ...header.presentation, fontStyle: 'italic' } } as BulletinBlock);
    expect(findBlock(updated, header.id)).toMatchObject({ type: 'richText', role: 'header', content: [{ children: [{ text: 'Welcome to Worship' }] }], presentation: { fontStyle: 'italic' } });
    expect(findBlock(updated, 'church-welcome-body')).toEqual(findBlock([church], 'church-welcome-body'));
    expect(flattenBlocks(updated)).toHaveLength(11);
  });
});
