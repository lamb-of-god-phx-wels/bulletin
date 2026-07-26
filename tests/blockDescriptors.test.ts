import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import descriptorSchema from '../schemas/block-descriptor-v1.schema.json';
import {
  instantiateBlockDescriptor,
  parseBlockDescriptor,
  prepackagedBlockDescriptors,
  validateBlockDescriptor
} from '../src/prepackagedBlocks';
import { flattenBlocks } from '../src/shared/blocks';

describe('pre-packaged block descriptors', () => {
  it('loads the omakase catalog from valid JSON descriptors in display order', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(descriptorSchema);
    expect(prepackagedBlockDescriptors).toHaveLength(12);
    expect(prepackagedBlockDescriptors.map(descriptor => descriptor.id)).toEqual([
      'scripture-reading',
      'song',
      'heading',
      'paragraph',
      'section-heading',
      'text',
      'responsive-reading',
      'library-text',
      'announcements',
      'church-information',
      'spacer',
      'copyright'
    ]);
    for (const descriptor of prepackagedBlockDescriptors) {
      expect(validate(descriptor), `${descriptor.id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(descriptor.block.presentation, `${descriptor.id} presentation`).toMatchObject({
        widthPercent: expect.any(Number),
        placement: expect.any(String),
        textAlign: expect.any(String),
        paddingIn: { top: expect.any(Number), right: expect.any(Number), bottom: expect.any(Number), left: expect.any(Number) },
        marginIn: { top: expect.any(Number), bottom: expect.any(Number) },
        fontFamily: expect.any(String),
        fontSizePt: expect.any(Number),
        lineHeight: expect.any(Number),
        fontWeight: expect.any(String),
        fontStyle: expect.any(String),
        textTransform: expect.any(String),
        color: expect.any(String),
        borderWidthPt: expect.any(Number),
        borderColor: expect.any(String),
        borderRadiusPt: expect.any(Number)
      });
      expect(descriptor.block.layout, `${descriptor.id} layout`).toEqual(expect.any(Object));
    }
  });

  it('creates independent block trees with fresh IDs and descriptor formatting', () => {
    const descriptor = prepackagedBlockDescriptors.find(item => item.id === 'paragraph')!;
    const first = instantiateBlockDescriptor(descriptor);
    const second = instantiateBlockDescriptor(descriptor);
    const firstTree = flattenBlocks([first]);
    const secondTree = flattenBlocks([second]);

    expect(first.type).toBe('paragraph');
    expect(first).toMatchObject({ layout: { keepTogether: true }, presentation: { widthPercent: 100, marginIn: { bottom: .16 } } });
    expect(firstTree.map(block => block.id)).toHaveLength(3);
    expect(new Set([...firstTree, ...secondTree].map(block => block.id))).toHaveLength(6);
    expect(firstTree[1]).toMatchObject({ type: 'richText', role: 'header', presentation: { fontWeight: 'bold' } });

    firstTree[1].presentation = { fontWeight: 'normal' };
    const fresh = flattenBlocks([instantiateBlockDescriptor(descriptor)]);
    expect(fresh[1].presentation?.fontWeight).toBe('bold');
  });

  it('can describe a complete nested church-information block', () => {
    const descriptor = prepackagedBlockDescriptors.find(item => item.id === 'church-information')!;
    const blocks = flattenBlocks([instantiateBlockDescriptor(descriptor)]);
    expect(blocks.filter(block => block.type === 'paragraph')).toHaveLength(4);
    expect(blocks.find(block => block.role === 'header')).toMatchObject({
      type: 'richText',
      content: [{ children: [{ text: 'Welcome' }] }]
    });
  });

  it('defines independent formatting for every Scripture-reading element', () => {
    const descriptor = prepackagedBlockDescriptors.find(item => item.id === 'scripture-reading')!;
    expect(descriptor.block.type).toBe('scriptureReading');
    if (descriptor.block.type !== 'scriptureReading') throw new Error('Expected Scripture descriptor.');
    expect(Object.keys(descriptor.block.elements ?? {})).toEqual(['heading', 'reference', 'caption', 'body']);
    const elements = flattenBlocks([instantiateBlockDescriptor(descriptor)])
      .filter(block => block.type === 'richText' && block.scriptureRole);
    expect(elements.map(element => element.type === 'richText' ? element.scriptureRole : undefined)).toEqual([
      'heading',
      'reference',
      'caption',
      'body'
    ]);
    expect(elements.every(element => element.presentation?.widthPercent === 100)).toBe(true);
    expect(elements.find(element => element.type === 'richText' && element.scriptureRole === 'caption')?.presentation)
      .toMatchObject({ fontStyle: 'italic', marginIn: { bottom: .12 } });
  });

  it('reports actionable descriptor and block validation errors', () => {
    const malformed = parseBlockDescriptor('{"schemaVersion":1,"id":"Bad ID","block":{"id":"root","type":"song"}}');
    expect(malformed.descriptor).toBeUndefined();
    expect(malformed.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('/id'),
      expect.stringContaining('/block/libraryItemId'),
      expect.stringContaining('/block/songType'),
      expect.stringContaining('/block/renderMode'),
      expect.stringContaining('/block/selection')
    ]));
    expect(parseBlockDescriptor('{bad json').issues[0]).toContain('JSON:');
  });

  it('supports descriptor-defined custom blocks with weekly data bindings', () => {
    const result = validateBlockDescriptor({
      schemaVersion: 1,
      id: 'bound-note',
      version: 1,
      name: 'Bound note',
      description: 'A reusable note with weekly content.',
      order: 100,
      block: {
        id: 'root',
        type: 'custom',
        name: 'Bound note',
        showName: true,
        layoutText: '{{message}}',
        bindings: [{
          key: 'message',
          label: 'Message',
          source: 'weekly',
          defaultValue: 'Hello'
        }],
        values: {},
        presentation: {
          widthPercent: 100,
          placement: 'left',
          textAlign: 'left',
          paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
          marginIn: { top: 0, right: 0, bottom: .16, left: 0 },
          fontFamily: 'body',
          fontSizePt: 10,
          lineHeight: 1.25,
          fontWeight: 'normal',
          fontStyle: 'normal',
          textTransform: 'none',
          color: '#202522',
          borderWidthPt: 0,
          borderColor: '#202522',
          borderRadiusPt: 0
        },
        layout: {
          density: 'normal',
          keepTogether: true
        }
      }
    });

    expect(result.issues).toEqual([]);
    expect(result.descriptor).toBeDefined();

    const block = instantiateBlockDescriptor(result.descriptor!);
    expect(block.type).toBe('custom');
    if (block.type !== 'custom') throw new Error('Expected a custom block.');
    expect(block.bindings[0]).toMatchObject({ key: 'message', source: 'weekly' });
    expect(block.presentation?.marginIn?.bottom).toBe(.16);
  });
});
