import { describe, expect, it } from 'vitest';
import { childBlocks, defaultChurchInfoChildren, findBlock, flattenBlocks, updateBlockTree } from '../src/shared/blocks';
import type { BulletinBlock } from '../src/shared/types';
import { blockDisplayName } from '../src/shared/blockNames';

describe('nested blocks', () => {
  it('uses concise content-aware element names and respects explicit renames', () => {
    const paragraph: BulletinBlock = {
      id: 'welcome', type: 'paragraph', children: [
        { id: 'welcome-heading', type: 'richText', role: 'header', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Welcome to Worship' }] }] },
        { id: 'welcome-body', type: 'richText', role: 'body', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body copy' }] }] },
      ],
    };
    expect(blockDisplayName(paragraph)).toBe('Welcome to Worship');
    expect(blockDisplayName({ ...paragraph, displayName: 'Opening welcome' })).toBe('Opening welcome');
    expect(blockDisplayName({ id: 'reading', type: 'scriptureReading', reference: 'John 1:1–5', translation: 'NIV' })).toBe('John 1:1–5');
    expect(blockDisplayName({ id: 'table', type: 'group', layoutMode: 'table', children: [] })).toBe('Table');
    expect(blockDisplayName({ id: 'template', type: 'templateInstance', name: '', source: { id: 'weekly', version: 1 }, sourceDigest: 'digest', blocks: [] })).toBe('Sub-template');
  });

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

  it('materializes and independently updates all four Scripture elements', () => {
    const scripture: BulletinBlock = {
      id: 'reading',
      type: 'scriptureReading',
      label: 'First Reading',
      reference: 'Genesis 1:1-5',
      caption: 'The beginning of creation.',
      translation: 'NIV',
      resolved: {
        content: [{ type: 'paragraph', children: [{ type: 'text', text: 'In the beginning God created.' }] }],
        source: 'manual',
        retrievedAt: '2026-07-24T00:00:00.000Z',
        attribution: 'NIV — text supplied by user'
      }
    };

    expect(childBlocks(scripture)?.map(block => block.type === 'richText' ? block.scriptureRole : undefined)).toEqual([
      'heading',
      'reference',
      'caption',
      'body'
    ]);

    const reference = findBlock([scripture], 'reading-reference')!;
    const updated = updateBlockTree([scripture], reference.id, {
      ...reference,
      displayName: 'Gospel opening',
      content: [{ type: 'paragraph', children: [{ type: 'text', text: 'John 1:1-5' }] }],
      presentation: { ...reference.presentation, textAlign: 'right', widthPercent: 60 }
    } as BulletinBlock);

    expect(updated[0]).toMatchObject({
      type: 'scriptureReading',
      reference: 'John 1:1-5',
      resolved: undefined,
      elements: {
        reference: {
          displayName: 'Gospel opening',
          presentation: { textAlign: 'right', widthPercent: 60 }
        }
      }
    });
    expect(findBlock(updated, 'reading-heading')).toMatchObject({
      scriptureRole: 'heading',
      content: [{ children: [{ text: 'First Reading' }] }]
    });
    expect(blockDisplayName(findBlock(updated, 'reading-reference')!)).toBe('Gospel opening');
  });
});
