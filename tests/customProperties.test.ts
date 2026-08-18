import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageTemplatePropertiesPanel, TemplatePropertiesPanel, ThisSundayProperties, WeeklyPropertiesPanel } from '../src/components/CustomProperties';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { boundRichTextParagraphs } from '../src/shared/canvas';
import { customPropertyBinding, customPropertyIssues, effectiveCustomPropertyValue, resolveConditionalBlocks, synchronizeCustomPropertyBindings, textBindingValue } from '../src/shared/customProperties';
import { instantiatePageTemplate } from '../src/shared/pageTemplates';
import { paginate } from '../src/shared/pagination';
import { templateFromBulletin } from '../src/shared/templates';
import type { BulletinBlock, CustomPropertyDefinition, PageTemplateV1, TemplateV1 } from '../src/shared/types';

const enabled: CustomPropertyDefinition = { id: 'show-communion', name: 'Show Communion', valueType: 'boolean', defaultValue: false };
const serviceTime: CustomPropertyDefinition = { id: 'service-time', name: 'Service Time', valueType: 'string', defaultValue: '9:00 AM' };
const attendance: CustomPropertyDefinition = { id: 'attendance', name: 'Attendance', valueType: 'number', defaultValue: 125 };

const template = (): TemplateV1 => ({ ...structuredClone(defaultTemplate), customProperties: [enabled, serviceTime, attendance], starterBlocks: [] });

describe('custom properties and conditional blocks', () => {
  it('renders immutable property types in compact rows with one creation menu trigger', () => {
    const host = template();
    const markup = renderToStaticMarkup(createElement(TemplatePropertiesPanel, { template: host, onChange: () => undefined }));
    expect(markup).toContain('custom-property-definition-line');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain('<select');
    expect(markup.match(/＋ Property/g)).toHaveLength(1);
  });

  it('only shows the compact bulletin reset action for overridden values', () => {
    const host = template();
    const document = createBulletin(host);
    const inherited = renderToStaticMarkup(createElement(WeeklyPropertiesPanel, { document, template: host, onChange: () => undefined }));
    document.customPropertyOverrides = { [serviceTime.id]: '10:30 AM' };
    const overridden = renderToStaticMarkup(createElement(WeeklyPropertiesPanel, { document, template: host, onChange: () => undefined }));
    expect(inherited).not.toContain('>Reset</button>');
    expect(overridden).toContain('>Reset</button>');
  });

  it('provides the same compact property editor for reusable pages', () => {
    const page: PageTemplateV1 = {
      schemaVersion: 1, id: 'page', version: 1, name: 'Page', status: 'draft', layout: 'regular',
      margin: { mode: 'inherit', referenceMarginIn: .4 }, customProperties: [enabled], blocks: [], updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const markup = renderToStaticMarkup(createElement(PageTemplatePropertiesPanel, { pageTemplate: page, onChange: () => undefined }));
    expect(markup).toContain('Page design');
    expect(markup).toContain('Show Communion');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('Include in <i>This Sunday</i>');
  });

  it('shows opted-in property values directly in This Sunday', () => {
    const sundayTime = { ...serviceTime, includeInThisSunday: true };
    const host = { ...template(), customProperties: [enabled, sundayTime, attendance] };
    const document = createBulletin(host);
    const markup = renderToStaticMarkup(createElement(ThisSundayProperties, { document, template: host, onChange: () => undefined }));
    expect(markup).toContain('Service Time');
    expect(markup).toContain('9:00 AM');
    expect(markup).not.toContain('Attendance');
  });

  it('resolves typed template defaults and bulletin overrides deterministically', () => {
    const host = template();
    const document = createBulletin(host);
    expect(effectiveCustomPropertyValue(enabled.id, host, document)).toBe(false);
    expect(textBindingValue(customPropertyBinding(serviceTime), document, host)).toBe('9:00 AM');
    expect(textBindingValue(customPropertyBinding(attendance), document, host)).toBe('125');
    expect(textBindingValue(customPropertyBinding(enabled), document, host)).toBe('False');
    document.customPropertyOverrides = { [enabled.id]: true, [attendance.id]: 147 };
    expect(effectiveCustomPropertyValue(enabled.id, host, document)).toBe(true);
    expect(textBindingValue(customPropertyBinding(enabled), document, host)).toBe('True');
    expect(textBindingValue(customPropertyBinding(attendance), document, host)).toBe('147');
  });

  it('lets a bulletin own and edit its property definitions', () => {
    const host = template();
    const document = createBulletin(host);
    expect(document.customProperties).toEqual(host.customProperties);
    expect(document.customProperties).not.toBe(host.customProperties);
    document.customProperties = document.customProperties!.map(property => property.id === serviceTime.id
      ? { ...property, name: 'Saturday Service Time', defaultValue: '5:00 PM' }
      : property);
    document.blocks = synchronizeCustomPropertyBindings([
      { id: 'time', type: 'richText', content: [], binding: customPropertyBinding(serviceTime) },
    ], document.customProperties);
    expect(effectiveCustomPropertyValue(serviceTime.id, host, document)).toBe('5:00 PM');
    expect(document.blocks[0].type === 'richText' ? document.blocks[0].binding : undefined).toMatchObject({ propertyName: 'Saturday Service Time' });
  });

  it('binds custom values into structured text while preserving a local resettable override', () => {
    const host = template();
    const document = createBulletin(host);
    const block = { id: 'time', type: 'richText' as const, content: [], binding: customPropertyBinding(serviceTime) };
    expect(boundRichTextParagraphs(block, document, host)[0].children[0]).toMatchObject({ text: '9:00 AM' });
    expect(boundRichTextParagraphs({ ...block, bindingOverride: [{ type: 'paragraph', children: [{ type: 'text', text: 'Special time' }] }] }, document, host)[0].children[0]).toMatchObject({ text: 'Special time' });
  });

  it('removes conditionally hidden elements before pagination', () => {
    const host = template();
    const child: BulletinBlock = { id: 'communion', type: 'heading', text: 'Communion', condition: { property: customPropertyBinding(enabled), equals: true } };
    host.starterBlocks = [child];
    const document = createBulletin(host);
    expect(resolveConditionalBlocks(document.blocks, host, document)).toEqual([]);
    expect(paginate(document.blocks, host, undefined, document).flatMap(page => page.blocks).some(block => block.id === 'communion')).toBe(false);
    document.customPropertyOverrides = { [enabled.id]: true };
    expect(resolveConditionalBlocks(document.blocks, host, document)).toEqual([child]);
    expect(paginate(document.blocks, host, undefined, document)[0].blocks[0]).toMatchObject({ id: 'communion' });
  });

  it('maps reusable page bindings to a host property with the same name and type', () => {
    const sourceBinding = { ...customPropertyBinding(serviceTime), propertyId: 'other-template-id' };
    const page: PageTemplateV1 = {
      schemaVersion: 1, id: 'welcome-page', version: 1, name: 'Welcome', status: 'published', layout: 'regular',
      margin: { mode: 'inherit', referenceMarginIn: .4 }, updatedAt: '2026-08-01T00:00:00.000Z',
      blocks: [{ id: 'time', type: 'richText', content: [], binding: sourceBinding }],
    };
    const instance = instantiatePageTemplate(page, 'page', template());
    const block = instance.blocks[0];
    expect(block.type === 'richText' ? block.binding : undefined).toMatchObject({ propertyId: serviceTime.id, propertyName: serviceTime.name });
  });

  it('carries page-owned property defaults into an inserted page', () => {
    const page: PageTemplateV1 = {
      schemaVersion: 1, id: 'welcome-page', version: 1, name: 'Welcome', status: 'published', layout: 'regular',
      margin: { mode: 'inherit', referenceMarginIn: .4 }, customProperties: [serviceTime], updatedAt: '2026-08-01T00:00:00.000Z',
      blocks: [{ id: 'time', type: 'richText', content: [], binding: customPropertyBinding(serviceTime) }],
    };
    const host: TemplateV1 = { ...structuredClone(defaultTemplate), customProperties: [], starterBlocks: [instantiatePageTemplate(page, 'page')] };
    const document = createBulletin(host);
    expect(effectiveCustomPropertyValue(serviceTime.id, host, document)).toBe('9:00 AM');
    expect(textBindingValue(customPropertyBinding(serviceTime), document, host)).toBe('9:00 AM');
  });

  it('validates definitions, references, and condition types', () => {
    const host = template();
    host.customProperties!.push({ ...serviceTime, id: 'duplicate-name' });
    host.starterBlocks = [{ id: 'conditional-heading', type: 'heading', text: 'Conditional heading', condition: { property: customPropertyBinding(serviceTime), equals: true } }];
    const messages = customPropertyIssues(host).map(issue => issue.message);
    expect(messages).toContain('Custom property names must be unique: Service Time');
    expect(messages).toContain('Conditions require a Toggle property.');
  });

  it('reports malformed conditional JSON without throwing', () => {
    const host = template();
    host.starterBlocks = [{ id: 'broken', type: 'heading', text: 'Broken', condition: {} } as unknown as BulletinBlock];
    expect(customPropertyIssues(host).map(issue => issue.message)).toEqual(expect.arrayContaining([
      'Conditions require a custom property binding.',
      'Conditional comparison must be on or off.',
    ]));
  });

  it('promotes resolved bulletin overrides to defaults when creating a template', () => {
    const foundation = template();
    const document = createBulletin(foundation);
    document.customPropertyOverrides = { [serviceTime.id]: '10:30 AM' };
    document.customProperties = document.customProperties?.map(property => property.id === serviceTime.id ? { ...property, name: 'Worship Time' } : property);
    const created = templateFromBulletin(document, foundation, 'Copied template', []);
    expect(created.customProperties?.find(property => property.id === serviceTime.id)?.defaultValue).toBe('10:30 AM');
    expect(created.customProperties?.find(property => property.id === serviceTime.id)?.name).toBe('Worship Time');
  });
});
