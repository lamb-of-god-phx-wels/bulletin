import { describe, expect, it } from 'vitest';
import componentSchema from '../schemas/component-definition.schema.json';
import {
  instantiateComponentDefinition,
  parseImportedComponent,
  prepackagedComponentDefinitions,
  prepackagedComponentDiagnostics
} from '../src/componentDefinitions';
import { flattenBlocks } from '../src/shared/blocks';
import { bulletinEditorElementPaletteItems, canvasElementPaletteItems, flowElementPaletteItems } from '../src/components/elementPaletteCatalog';

describe('component definitions', () => {
  it('loads the complete omakase palette from schema-version-2 JSON', () => {
    expect(prepackagedComponentDiagnostics).toEqual([]);
    expect(prepackagedComponentDefinitions).toHaveLength(10);
    expect(prepackagedComponentDefinitions.map(definition => definition.type)).toEqual([
      'bulletin:scriptureReading',
      'bulletin:song',
      'bulletin:heading',
      'bulletin:paragraph',
      'bulletin:sectionHeading',
      'bulletin:text',
      'bulletin:responsiveReading',
      'bulletin:list',
      'bulletin:spacer',
      'bulletin:copyright'
    ]);
    expect(prepackagedComponentDefinitions.every(definition => definition.schemaVersion === 2)).toBe(true);
  });

  it('uses native paragraphs and lists instead of specialized reusable-text, announcement, and church-page entries', () => {
    const types = prepackagedComponentDefinitions.map(definition => definition.type);
    expect(types).not.toEqual(expect.arrayContaining(['bulletin:libraryText', 'bulletin:announcements', 'bulletin:churchInformation']));
    const list = prepackagedComponentDefinitions.find(definition => definition.type === 'bulletin:list')!;
    expect(instantiateComponentDefinition(list)).toMatchObject({ type: 'list', style: 'plain', items: [{ title: 'New item' }] });
  });

  it('names embedded bulletin templates as sub-templates', () => {
    expect(flowElementPaletteItems([]).find(item => item.id === 'native:template')).toMatchObject({ label: 'Sub-template' });
    expect(flowElementPaletteItems([]).find(item => item.id === 'native:page')).toMatchObject({ label: 'Page Design' });
  });

  it('offers Text only in page design palettes', () => {
    expect(bulletinEditorElementPaletteItems([]).map(item => item.label)).not.toContain('Text');
    expect(bulletinEditorElementPaletteItems([]).map(item => item.label)).toContain('Paragraph');
    expect(flowElementPaletteItems([]).map(item => item.label)).toContain('Text');
    expect(canvasElementPaletteItems([]).map(item => item.label)).toContain('Text');
  });

  it('describes songs as composed layout rather than a block prototype', () => {
    const song = prepackagedComponentDefinitions.find(definition => definition.type === 'bulletin:song')!;
    expect(song.name).toBe('Song');
    expect(song).not.toHaveProperty('block');
    expect(song.editor?.fields.map(field => field.input)).not.toContain('asset');
    expect(JSON.stringify(song.template)).toContain('bulletin:songVerse');
    expect(JSON.stringify(song.template)).toContain('core:image');
    expect(instantiateComponentDefinition(song)).toMatchObject({
      type: 'song',
      songType: 'song',
      libraryItemId: '',
      renderMode: 'lyrics'
    });
    expect(instantiateComponentDefinition(song)).not.toHaveProperty('title');
    expect(instantiateComponentDefinition(song)).not.toHaveProperty('contentOverride');
  });

  it('instantiates independent editable blocks from component defaults', () => {
    const paragraph = prepackagedComponentDefinitions.find(definition => definition.type === 'bulletin:paragraph')!;
    const first = instantiateComponentDefinition(paragraph);
    const second = instantiateComponentDefinition(paragraph);
    expect(first.id).not.toBe(second.id);
    expect(flattenBlocks([first]).map(block => block.id)).not.toEqual(flattenBlocks([second]).map(block => block.id));
  });

  it('creates copyright blocks without default extra text', () => {
    const definition = prepackagedComponentDefinitions.find(item => item.type === 'bulletin:copyright')!;
    const block = instantiateComponentDefinition(definition);
    expect(block.type).toBe('copyright');
    expect(block).not.toHaveProperty('extra');
    expect(block).not.toHaveProperty('beforeNotices');
    expect(block).not.toHaveProperty('afterNotices');
    expect(block.presentation?.borderWidthPt).toBe(1);
  });

  it('validates imported definitions with the same contract as packaged components', () => {
    const source = JSON.stringify({
      ...prepackagedComponentDefinitions[0],
      type: 'custom:testScripture'
    });
    expect(parseImportedComponent(source).diagnostics).toEqual([]);
    expect(parseImportedComponent('{bad json').diagnostics[0]).toMatchObject({ code: 'COMPONENT_JSON_INVALID' });
    expect(componentSchema.properties.schemaVersion).toEqual({ const: 2 });
  });
});
