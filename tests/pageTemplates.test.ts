import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPageTemplate, defaultTemplate } from '../src/shared/defaults';
import { boundRichTextParagraphs, createCanvasBlock } from '../src/shared/canvas';
import { createBulletin } from '../src/shared/defaults';
import { paginate } from '../src/shared/pagination';
import {
  createPageTemplate,
  explodeTemplatePage,
  instantiatePageTemplate,
  pageTemplateDigest,
  pageTemplateIssues,
  pageTemplateLayout,
  pageTemplateMargin
} from '../src/shared/pageTemplates';
import { validateBulletin } from '../src/shared/validation';
import { DocumentView } from '../src/components/DocumentView';

describe('single-page templates', () => {
  it('keeps canvas and regular page layouts distinct', () => {
    const canvas = createPageTemplate('Canvas', [], [createCanvasBlock('canvas')], { mode: 'fixed', marginIn: 0 }, 'canvas');
    const regular = createPageTemplate('Regular', [], [], { mode: 'inherit', referenceMarginIn: .4 }, 'regular');
    expect(pageTemplateLayout(canvas)).toBe('canvas');
    expect(pageTemplateLayout(regular)).toBe('regular');
    expect(pageTemplateIssues({ ...canvas, blocks: [] })).toContain('Canvas page templates must contain exactly one canvas.');
    expect(pageTemplateIssues({ ...regular, blocks: [createCanvasBlock('canvas')] })).toContain('Regular page templates cannot contain canvas blocks.');
  });

  it('creates deterministic pinned snapshots that survive source edits', () => {
    const instance = instantiatePageTemplate(defaultPageTemplate, 'page');
    const original = pageTemplateDigest(defaultPageTemplate);
    defaultPageTemplate.blocks[0].label = 'Temporary source edit';
    expect(instance.source).toEqual({ id: 'default-cover', version: 1 });
    expect(instance.sourceDigest).toBe(original);
    expect(instance.blocks[0].label).toBeUndefined();
    delete defaultPageTemplate.blocks[0].label;
  });

  it('keeps a linked page on one sheet and applies its fixed margin', () => {
    const instance = instantiatePageTemplate({ ...defaultPageTemplate, margin: { mode: 'fixed', marginIn: .2 } }, 'page');
    const pages = paginate([
      { id: 'before', type: 'heading', text: 'Before' },
      instance,
      { id: 'after', type: 'heading', text: 'After' }
    ], defaultTemplate);
    expect(pages.slice(0, 3).map(page => page.blocks[0].id)).toEqual(['before', 'page', 'after']);
    expect(pages[1].marginIn).toBe(.2);
    expect(pageTemplateMargin({ mode: 'inherit', referenceMarginIn: .7 }, .45)).toBe(.45);
  });

  it('explodes into native blocks, starts a page, and remaps colliding IDs', () => {
    const page = createPageTemplate('Page', [], [
      { id: 'same', type: 'heading', text: 'Inside' },
      { id: 'body', type: 'richText', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }
    ]);
    const result = explodeTemplatePage([
      { id: 'same', type: 'heading', text: 'Outside' },
      instantiatePageTemplate(page, 'instance')
    ], 'instance');
    expect(result.map(block => block.id)).toEqual(['same', 'same-2', 'body']);
    expect(result[1].layout?.pageBreakBefore).toBe(true);
  });

  it('rejects nested pages and legacy covers', () => {
    const nested = instantiatePageTemplate(defaultPageTemplate, 'nested');
    expect(pageTemplateIssues({ blocks: [nested], margin: { mode: 'inherit', referenceMarginIn: .4 } })).toContain('Page templates cannot contain another template page.');
    expect(pageTemplateIssues({ blocks: [{ id: 'old', type: 'titlePage' }], margin: { mode: 'fixed', marginIn: .4 } })).toContain('Legacy cover blocks are not supported.');
  });

  it('resolves native bound text and honors a local override', () => {
    const document = createBulletin(defaultTemplate, '2026-07-29');
    document.info.title = 'Bound sermon';
    const block = { id: 'bound', type: 'richText' as const, binding: 'info.title' as const, content: [] };
    expect(boundRichTextParagraphs(block, document)[0].children[0]).toMatchObject({ text: 'Bound sermon' });
    expect(boundRichTextParagraphs({ ...block, bindingOverride: [{ type: 'paragraph', children: [{ type: 'text', text: 'Local value' }] }] }, document)[0].children[0]).toMatchObject({ text: 'Local value' });
  });

  it('blocks export when an inherited page overflows at the host margin', () => {
    const document = createBulletin(defaultTemplate, '2026-07-29');
    const source = {
      ...defaultPageTemplate,
      margin: { mode: 'inherit' as const, referenceMarginIn: .2 },
      blocks: [{ id: 'too-tall', type: 'canvas' as const, heightIn: 8, widthMode: 'contentBox' as const, scene: { coordinateSpace: 'fullPage' as const, elements: [] } }]
    };
    document.layout = { marginIn: .5 };
    document.blocks = [instantiatePageTemplate(source, 'page')];
    expect(validateBulletin(document, undefined, defaultTemplate).some(issue => issue.message.includes('overflows'))).toBe(true);
  });

  it('shows a blank physical page for an empty single-page preview', () => {
    const document = createBulletin(defaultTemplate, '2026-07-29');
    document.blocks = [];
    const markup = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      singlePage: true,
      rulers: false,
      guides: false
    }));
    expect(markup).toContain('page-frame');
    expect(markup).toContain('document-page page-kind-content');
  });
});
