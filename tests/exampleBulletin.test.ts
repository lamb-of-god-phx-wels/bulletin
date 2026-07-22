import { describe, expect, it } from 'vitest';
import example from '../example_bulletin.json';
import { defaultTemplate } from '../src/shared/defaults';
import { exampleLibrary } from '../src/shared/exampleLibrary';
import { paginate } from '../src/shared/pagination';
import type { BulletinDocumentV1, TemplateV1 } from '../src/shared/types';

const template: TemplateV1 = {
  ...defaultTemplate,
  theme: {
    ...defaultTemplate.theme,
    bodyFont: 'CalibriLocal, Calibri, Arial, sans-serif',
    displayFont: 'ErasLocal, Georgia, serif',
    bodySizePt: 8,
    lineHeight: 1.16,
    marginIn: 0.3
  }
};

describe('June 7, 2026 example bulletin', () => {
  it('recreates the source booklet as twelve deliberately composed pages', () => {
    const pages = paginate((example as BulletinDocumentV1).blocks, template, exampleLibrary);
    expect(pages).toHaveLength(12);
    expect(pages.map(page => page.blocks[0]?.id)).toEqual([
      'titlepage',
      'welcomepage',
      'god-loves-sinners',
      'responsivereading-3',
      'song-of-praise',
      'first-reading-continuation',
      'psalm-continuation',
      'children-s-message',
      'hymn-of-the-day-continuation',
      'the-prayers',
      'closing-song',
      'announcements-part-1'
    ]);
    expect(pages[4].blocks.map(block => block.id)).toContain('first-reading');
    expect(pages[5].blocks.map(block => block.id)).toContain('psalm');
    expect(pages[8].blocks.map(block => block.id)).toEqual(expect.arrayContaining(['sermon', 'confession-of-faith']));
    expect(pages[9].blocks.map(block => block.id)).toContain('copyrightblock');
  });

  it('includes the source readings, music assets, notices, and complete announcements', () => {
    const bulletin = example as BulletinDocumentV1;
    const sermon = bulletin.blocks.find(block => block.id === 'sermon');
    const announcements = bulletin.blocks.find(block => block.id === 'announcements');
    const psalm = bulletin.blocks.find(block => block.id === 'psalm');
    expect(bulletin.id).toBe('bulletin-2026-06-07');
    expect(sermon?.type === 'scriptureReading' && sermon.resolved?.content[0].children[0]).toMatchObject({ text: expect.stringMatching(/^I thank Christ Jesus our Lord/) });
    expect(psalm?.type === 'song' && psalm.asset?.path).toContain('psalm-130-part-1.png');
    expect(announcements?.type === 'announcements' && announcements.items).toHaveLength(6);
    expect(announcements?.type === 'announcements' && announcements.items.at(-1)?.title).toBe('Giving to Lamb of God');
  });
});
