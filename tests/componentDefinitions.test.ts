import { describe, expect, it } from 'vitest';
import componentSchema from '../schemas/component-definition.schema.json';
import {
  instantiateComponentDefinition,
  parseImportedComponent,
  prepackagedComponentDefinitions,
  prepackagedComponentDiagnostics
} from '../src/componentDefinitions';
import { flattenBlocks } from '../src/shared/blocks';

describe('component definitions', () => {
  it('loads the complete omakase palette from schema-version-2 JSON', () => {
    expect(prepackagedComponentDiagnostics).toEqual([]);
    expect(prepackagedComponentDefinitions).toHaveLength(13);
    expect(prepackagedComponentDefinitions.map(definition => definition.type)).toEqual([
      'bulletin:coverPage',
      'bulletin:scriptureReading',
      'bulletin:song',
      'bulletin:heading',
      'bulletin:paragraph',
      'bulletin:sectionHeading',
      'bulletin:text',
      'bulletin:responsiveReading',
      'bulletin:libraryText',
      'bulletin:announcements',
      'bulletin:churchInformation',
      'bulletin:spacer',
      'bulletin:copyright'
    ]);
    expect(prepackagedComponentDefinitions.every(definition => definition.schemaVersion === 2)).toBe(true);
  });

  it('describes songs as composed layout rather than a block prototype', () => {
    const song = prepackagedComponentDefinitions.find(definition => definition.type === 'bulletin:song')!;
    expect(song).not.toHaveProperty('block');
    expect(JSON.stringify(song.template)).toContain('bulletin:songVerse');
    expect(JSON.stringify(song.template)).toContain('core:image');
  });

  it('instantiates independent editable blocks from component defaults', () => {
    const paragraph = prepackagedComponentDefinitions.find(definition => definition.type === 'bulletin:paragraph')!;
    const first = instantiateComponentDefinition(paragraph);
    const second = instantiateComponentDefinition(paragraph);
    expect(first.id).not.toBe(second.id);
    expect(flattenBlocks([first]).map(block => block.id)).not.toEqual(flattenBlocks([second]).map(block => block.id));
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
