import { describe, expect, it } from 'vitest';
import scriptureDefinition from '../component-definitions/prepackaged/scripture-reading.json';
import { evaluateBoundValue } from '../src/component-engine/bindings';
import { loadComponentCatalog } from '../src/component-engine/catalog';
import { structuredTextFromV1Paragraphs } from '../src/component-engine/compatibility';
import { evaluateComponent, rootEvaluationContext } from '../src/component-engine/evaluate';
import { ComponentRegistry } from '../src/component-engine/registry';
import type { ComponentInstanceV2, DeclarativeComponentDefinition } from '../src/component-engine/types';

const definition = scriptureDefinition as unknown as DeclarativeComponentDefinition;
const body = {
  blocks: [{
    type: 'paragraph' as const,
    inlines: [
      { type: 'verseNumber' as const, value: '1' },
      { type: 'text' as const, value: 'In the beginning was the Word.' }
    ]
  }]
};

describe('v2 component engine', () => {
  it('validates and quarantines duplicate component definitions', () => {
    const raw = JSON.stringify(definition);
    const catalog = loadComponentCatalog({ 'scripture.json': raw, 'duplicate.json': raw });
    expect(catalog.registry.list()).toHaveLength(1);
    expect(catalog.diagnostics).toEqual([expect.objectContaining({
      code: 'COMPONENT_DUPLICATE',
      componentType: 'bulletin:scriptureReading'
    })]);
  });

  it('rejects missing and cyclic component dependencies', () => {
    const missing = {
      ...definition,
      type: 'custom:missingDependency',
      template: { type: 'custom:notInstalled' }
    };
    expect(loadComponentCatalog({ 'missing.json': JSON.stringify(missing) }).diagnostics).toContainEqual(expect.objectContaining({
      code: 'COMPONENT_DEPENDENCY_MISSING',
      componentType: 'custom:missingDependency'
    }));
    const cycle = {
      ...definition,
      type: 'custom:cycle',
      template: { type: 'custom:cycle' }
    };
    expect(loadComponentCatalog({ 'cycle.json': JSON.stringify(cycle) }).diagnostics).toContainEqual(expect.objectContaining({
      code: 'COMPONENT_DEPENDENCY_CYCLE',
      componentType: 'custom:cycle'
    }));
  });

  it('uses explicit binding namespaces and required-value diagnostics', () => {
    const context = rootEvaluationContext({ reading: { reference: 'John 1:1' } });
    expect(evaluateBoundValue({ $bind: 'data.reading.reference' }, context)).toEqual({
      value: 'John 1:1',
      diagnostics: []
    });
    expect(evaluateBoundValue({ $bind: 'reading.reference' }, context).diagnostics[0]).toMatchObject({
      code: 'BINDING_INVALID'
    });
    expect(evaluateBoundValue({ $bind: 'data.reading.caption', required: true }, context).diagnostics[0]).toMatchObject({
      code: 'BINDING_REQUIRED'
    });
  });

  it('expands Scripture into independently sourced and formatted layout parts', () => {
    const registry = new ComponentRegistry();
    expect(registry.register(definition)).toEqual([]);
    const instance: ComponentInstanceV2 = {
      id: 'first-reading',
      component: { type: 'bulletin:scriptureReading', version: 1 },
      inputs: {
        heading: { $bind: 'data.heading' },
        reference: { $bind: 'data.reference', required: true },
        headingReferenceLayout: 'inline',
        headingReferenceGapIn: 0,
        caption: { $bind: 'data.caption' },
        body: { $bind: 'data.body', required: true }
      },
      style: {
        parts: {
          reference: { widthPercent: 60, placement: 'right', textAlign: 'right' },
          body: { fontSizePt: 9.5 }
        }
      }
    };
    const result = evaluateComponent(instance, registry, rootEvaluationContext({
      heading: 'First Reading',
      reference: 'John 1:1–5',
      caption: null,
      body
    }));
    expect(result.diagnostics).toEqual([]);
    expect(result.node).toMatchObject({
      type: 'stack',
      source: { instanceId: 'first-reading', componentType: 'bulletin:scriptureReading' }
    });
    if (result.node?.type !== 'stack') throw new Error('Expected a stack.');
    expect(result.node.children.map(child => child.source.part)).toEqual(['headingReferenceRow', 'body']);
    const headingReference = result.node.children[0];
    if (headingReference.type !== 'row') throw new Error('Expected an inline heading/reference row.');
    expect(headingReference.style?.gapIn).toBe(0);
    expect(headingReference.children.map(child => child.source.part)).toEqual(['heading', 'reference']);
    expect(headingReference.children[1].style).toMatchObject({
      widthPercent: 60,
      placement: 'right',
      textAlign: 'right',
      keepWithNext: true
    });
    expect(result.node.children[1].style?.fontSizePt).toBe(9.5);

    const stacked = evaluateComponent({
      ...instance,
      inputs: { ...instance.inputs, headingReferenceLayout: 'stacked' }
    }, registry, rootEvaluationContext({
      heading: 'First Reading',
      reference: 'John 1:1–5',
      caption: null,
      body
    }));
    if (stacked.node?.type !== 'stack') throw new Error('Expected a stack.');
    expect(stacked.node.children.map(child => child.source.part)).toEqual(['heading', 'reference', 'body']);
  });

  it('adapts existing Scripture paragraphs without losing verse markers or line breaks', () => {
    expect(structuredTextFromV1Paragraphs([{
      type: 'paragraph',
      children: [
        { type: 'text', text: '1', marks: ['superscript'] },
        { type: 'text', text: 'In the beginning.', marks: ['italic'] },
        { type: 'lineBreak' },
        { type: 'text', text: '2', marks: ['superscript'] }
      ]
    }])).toEqual({
      blocks: [
        {
          type: 'paragraph',
          inlines: [
            { type: 'verseNumber', value: '1', marks: ['superscript'] },
            { type: 'text', value: 'In the beginning.', marks: ['italic'], emphasis: 'italic' }
          ]
        },
        { type: 'lineBreak' },
        { type: 'paragraph', inlines: [{ type: 'verseNumber', value: '2', marks: ['superscript'] }] }
      ]
    });
  });
});
