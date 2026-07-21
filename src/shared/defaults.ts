import type { BulletinDocumentV1, TemplateV1 } from './types.js';

const now = () => new Date().toISOString();

export const defaultTemplate: TemplateV1 = {
  schemaVersion: 1,
  id: 'lamb-of-god-weekly',
  version: 1,
  name: 'Lamb of God Weekly',
  status: 'published',
  page: { widthIn: 7, heightIn: 8.5, pageMultiple: 4 },
  theme: {
    bodyFont: 'Calibri, Arial, sans-serif',
    displayFont: 'Eras Demi ITC, Georgia, serif',
    ink: '#25302d',
    accent: '#a44d2a',
    bodySizePt: 10,
    lineHeight: 1.28,
    marginIn: 0.48
  },
  starterBlocks: [
    { id: 'cover', type: 'titlePage', weeklyEditable: true },
    { id: 'church-info', type: 'churchInfo' },
    { id: 'sermon-title', type: 'sermonTitle', text: 'Sermon title', weeklyEditable: true },
    { id: 'gathering', type: 'sectionHeading', text: 'The Gathering' },
    { id: 'opening-hymn', type: 'song', songType: 'hymn', libraryItemId: '', selection: { mode: 'all' }, renderMode: 'lyrics', label: 'Opening Hymn', weeklyEditable: true },
    { id: 'word', type: 'sectionHeading', text: 'The Word' },
    { id: 'first-reading', type: 'scriptureReading', reference: '', translation: 'NIV', label: 'First Reading', weeklyEditable: true },
    { id: 'gospel', type: 'scriptureReading', reference: '', translation: 'NIV', label: 'Gospel', weeklyEditable: true },
    { id: 'sermon', type: 'scriptureReading', reference: '', translation: 'NIV', label: 'Sermon', weeklyEditable: true },
    { id: 'prayers', type: 'sectionHeading', text: 'The Prayers' },
    { id: 'announcements', type: 'announcements', items: [], weeklyEditable: true },
    { id: 'copyright', type: 'copyright' }
  ],
  filler: { kind: 'blank' },
  updatedAt: now()
};

export function createBulletin(template: TemplateV1, date = new Date().toISOString().slice(0, 10)): BulletinDocumentV1 {
  return {
    schemaVersion: 1,
    id: `bulletin-${date}`,
    revision: 0,
    template: { id: template.id, version: template.version },
    church: { name: 'Lamb of God Lutheran Church' },
    info: { title: 'Sermon title', date, churchWeek: 'Sunday' },
    blocks: structuredClone(template.starterBlocks),
    updatedAt: now()
  };
}
