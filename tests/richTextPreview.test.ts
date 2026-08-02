import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentView } from '../src/components/DocumentView';
import { RichTextToolbar } from '../src/components/RichTextEditing';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { customPropertyBinding } from '../src/shared/customProperties';

describe('global rich-text preview editing', () => {
  it('renders flow text as editable only when a source updater is supplied', () => {
    const document = createBulletin(defaultTemplate, '2026-08-02');
    document.blocks = [{ id: 'heading', type: 'heading', text: 'Welcome' }];
    const editable = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      rulers: false,
      onBlockChange: () => undefined,
    }));
    const readonly = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      rulers: false,
    }));
    expect(editable).toContain('contentEditable="true"');
    expect(editable).toContain('aria-label="Heading"');
    expect(readonly).not.toContain('contentEditable="true"');
  });

  it('makes the rendered responsive reading a direct-edit target', () => {
    const document = createBulletin(defaultTemplate, '2026-08-02');
    document.blocks = [{ id: 'reading', type: 'responsiveReading', entries: [{ reader: 'M', role: 'leader', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'The Lord be with you.' }] }] }] }];
    const markup = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      rulers: false,
      onBlockChange: () => undefined,
    }));
    expect(markup).toContain('responsive-reading-direct-target');
    expect(markup).toContain('response-row response-leader');
    expect(markup).not.toContain('contentEditable="true"');
  });

  it('renders the shared toolbar disabled when no rich-text target is focused', () => {
    const markup = renderToStaticMarkup(createElement(RichTextToolbar));
    expect(markup).toContain('aria-label="Text formatting"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Insert cross');
  });

  it('omits conditionally hidden elements without rendering a placeholder', () => {
    const property = { id: 'show-welcome', name: 'Show Welcome', valueType: 'boolean' as const, defaultValue: false };
    const template = { ...structuredClone(defaultTemplate), customProperties: [property] };
    const document = createBulletin(template, '2026-08-02');
    document.blocks = [{ id: 'welcome', type: 'heading', text: 'Welcome', condition: { property: customPropertyBinding(property), equals: true } }];
    const markup = renderToStaticMarkup(createElement(DocumentView, { document, template, rulers: false, onBlockChange: () => undefined }));
    expect(markup).not.toContain('Welcome');
    expect(markup).not.toContain('Hidden by condition');
  });
});
