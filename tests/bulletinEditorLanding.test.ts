import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BulletinEditorLanding } from '../src/components/BulletinEditorLanding';
import { TemplateChooserDialog } from '../src/components/TemplateChooserDialog';
import { CreateFromDialog } from '../src/components/CreateFromDialog';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import type { BulletinRecord } from '../src/shared/bulletins';

const record = (date: string, title: string): BulletinRecord => {
  const document = createBulletin(defaultTemplate, date);
  document.info.title = title;
  return { path: `bulletins/${date}/bulletin.json`, document };
};

describe('bulletin editor landing', () => {
  it('lists saved bulletins newest first and offers creation without a picker modal', () => {
    const markup = renderToStaticMarkup(createElement(BulletinEditorLanding, {
      bulletins: [record('2026-07-19', 'Older bulletin'), record('2026-08-16', 'Newest bulletin')],
      canCreate: true,
      onCreate: () => undefined,
      onEditTemplate: () => undefined,
      onSelect: () => undefined,
    }));

    expect(markup).toContain('Current bulletins');
    expect(markup).toContain('Create New');
    expect(markup).toContain('Edit Template');
    expect(markup.indexOf('Newest bulletin')).toBeLessThan(markup.indexOf('Older bulletin'));
    expect(markup).not.toContain('role="dialog"');
  });

  it('offers template selection and creation from the landing page', () => {
    const markup = renderToStaticMarkup(createElement(TemplateChooserDialog, {
      records: [{ path: 'templates/weekly/v1.json', template: defaultTemplate }],
      canCreate: true,
      onSelect: () => undefined,
      onCreate: () => undefined,
      onClose: () => undefined,
    }));
    expect(markup).toContain('Edit a template');
    expect(markup).toContain(defaultTemplate.name);
    expect(markup).toContain('Create New');
  });

  it('starts bulletin creation with blank, template, and past-bulletin choices', () => {
    const markup = renderToStaticMarkup(createElement(CreateFromDialog, {
      destination: 'bulletin',
      templates: [],
      bulletins: [],
      onCancel: () => undefined,
      onCreate: () => undefined,
    }));

    expect(markup).toContain('>Blank</b>');
    expect(markup).toContain('>Template</b>');
    expect(markup).toContain('Past bulletin');
  });
});
