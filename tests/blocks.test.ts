import { describe, expect, it } from 'vitest';
import { childBlocks, findBlock, flattenBlocks, updateBlockTree } from '../src/shared/blocks';
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

  it('traverses and updates every Element Chooser alternative', () => {
    const chooser: BulletinBlock = { id: 'chooser', type: 'elementChooser', property: { kind: 'customProperty', propertyId: 'choice', propertyName: 'Choice', valueType: 'list' }, choices: [
      { id: 'one', name: 'One', block: { id: 'one-block', type: 'heading', text: 'One' } },
      { id: 'two', name: 'Two', block: { id: 'two-block', type: 'heading', text: 'Two' } },
    ] };
    expect(flattenBlocks([chooser]).map(block => block.id)).toEqual(['chooser', 'one-block', 'two-block']);
    const updated = updateBlockTree([chooser], 'two-block', { id: 'two-block', type: 'heading', text: 'Updated' });
    expect(findBlock(updated, 'two-block')).toMatchObject({ text: 'Updated' });
    expect(blockDisplayName(chooser)).toBe('Element Chooser');
  });

  it('keeps empty chooser options selectable without treating them as child blocks', () => {
    const chooser: BulletinBlock = { id: 'chooser', type: 'elementChooser', property: { kind: 'customProperty', propertyId: 'choice', propertyName: 'Choice', valueType: 'list' }, choices: [
      { id: 'empty', name: 'Empty' },
      { id: 'filled', name: 'Filled', block: { id: 'filled-block', type: 'spacer', size: 'small' } },
    ] };
    expect(childBlocks(chooser)?.map(block => block.id)).toEqual(['filled-block']);
    expect(flattenBlocks([chooser]).map(block => block.id)).toEqual(['chooser', 'filled-block']);
  });
});
