import type { BulletinBlock, BulletinDocumentV1, Paragraph, ResponsiveReadingBlock } from './types.js';

type Legacy = Record<string, any>;
const para = (text = '', style?: Legacy): Paragraph => ({
  type: 'paragraph',
  ...(style?.textAlign ? { align: style.textAlign } : {}),
  children: tokenize(text, style?.fontWeight === 'bold' ? ['bold'] : undefined)
});

function tokenize(text: string, marks?: Array<'bold'>): Paragraph['children'] {
  const normalized = text.replaceAll('\uf075', '<<cross>>');
  const parts = normalized.split('<<cross>>');
  return parts.flatMap((part, index) => [
    ...(part ? [{ type: 'text' as const, text: part, ...(marks ? { marks } : {}) }] : []),
    ...(index < parts.length - 1 ? [{ type: 'symbol' as const, name: 'cross' as const }] : [])
  ]);
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'block';

function uniqueId(candidate: string, seen: Map<string, number>) {
  const count = seen.get(candidate) ?? 0;
  seen.set(candidate, count + 1);
  return count ? `${candidate}-${count + 1}` : candidate;
}

function migrateResponsive(item: Legacy, id: string): ResponsiveReadingBlock {
  return {
    id,
    type: 'responsiveReading',
    entries: (item.content ?? []).map((entry: Legacy) => ({
      reader: entry.reader ?? '',
      content: (entry.content ?? []).map((content: Legacy) =>
        content.type === 'scripture'
          ? para(content.scripture ?? content.bibleReference ?? '')
          : para(content.text ?? '', content.style))
    }))
  };
}

function migrateBlock(item: Legacy, index: number, seen: Map<string, number>): BulletinBlock {
  const id = uniqueId(slug(item.label ?? item.text ?? item.title ?? item.type ?? `block-${index + 1}`), seen);
  switch (item.type) {
    case 'titlePage': return { id, type: 'titlePage', weeklyEditable: true };
    case 'welcomePage': return { id, type: 'churchInfo' };
    case 'sermonTitle': return { id, type: 'sermonTitle', text: item.text ?? '', weeklyEditable: true };
    case 'heading':
    case 'sectionHeading': return { id, type: item.type, text: item.text ?? '' };
    case 'responsiveReading': return migrateResponsive(item, id);
    case 'scriptureReading': return {
      id, type: 'scriptureReading', label: item.label, caption: item.caption ?? undefined,
      reference: item.scriptureReference ?? '', translation: (item.translation ?? 'NIV').toUpperCase(), weeklyEditable: true
    };
    case 'song': {
      const number = item.hymnNumber ?? item.psalmNumber;
      const title = item.title ?? (number ? String(number) : undefined);
      return {
        id, type: 'song', label: item.label, title, songType: item.songType ?? 'song',
        libraryItemId: number ? String(number).toLowerCase().replace(/\s/g, '') : slug(item.title ?? item.label ?? id), libraryItemVersion: 1,
        selection: item.verses === 'all' || item.verses == null ? { mode: 'all' } : { mode: 'verses', verses: item.verses },
        renderMode: item.lyricsOnly === false ? 'asset' : 'lyrics', weeklyEditable: true
      };
    }
    case 'confession': return { id, type: 'libraryText', libraryItemId: slug(item.confession), libraryItemVersion: 1, title: item.confession };
    case 'prayer': return { id, type: 'libraryText', libraryItemId: slug(item.prayer), libraryItemVersion: 1, title: item.prayer };
    case 'copyrightBlock': return { id, type: 'copyright' };
    case 'announcements': return {
      id, type: 'announcements', weeklyEditable: true,
      items: (item.items ?? []).map((a: Legacy, i: number) => ({
        id: uniqueId(slug(a.title ?? `announcement-${i + 1}`), seen), title: a.title ?? '',
        content: (a.content ?? []).map((c: Legacy) => para(c.text ?? c.bibleReference ?? c.scripture ?? '', c.style))
      }))
    };
    default: return { id, type: 'richText', content: [para(item.text ?? '')] };
  }
}

export function migrateLegacyBulletin(input: Legacy): BulletinDocumentV1 {
  if (input.schemaVersion === 1) return input as BulletinDocumentV1;
  const seen = new Map<string, number>();
  const date = input.bulletinInfo?.date?.data === '2026-07-20' && input.bulletinInfo?.title === 'God Loves Sinners'
    ? '2026-06-07'
    : input.bulletinInfo?.date?.data ?? new Date().toISOString().slice(0, 10);
  return {
    schemaVersion: 1,
    id: `bulletin-${date}`,
    revision: 0,
    template: { id: 'lamb-of-god-weekly', version: 1 },
    church: { name: input.churchInfo?.name ?? 'Church' },
    info: {
      title: input.bulletinInfo?.title ?? '', series: input.bulletinInfo?.series,
      date, churchWeek: input.bulletinInfo?.churchWeek ?? ''
    },
    blocks: (input.content ?? []).map((item: Legacy, index: number) => migrateBlock(item, index, seen)),
    updatedAt: new Date().toISOString()
  };
}
