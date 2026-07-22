import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const source = execFileSync('pdftotext', ['-layout', 'example_bulletins/6 7 2026.pdf', '-'], { encoding: 'utf8' });
const document = JSON.parse(await readFile('example_bulletin.json', 'utf8'));
const block = id => document.blocks.find(item => item.id === id);
const between = (start, end, from = 0) => {
  const begin = source.indexOf(start, from);
  if (begin < 0) throw new Error('Missing source marker: ' + start);
  const finish = source.indexOf(end, begin + start.length);
  if (finish < 0) throw new Error('Missing source marker: ' + end);
  return source.slice(begin + start.length, finish);
};
const clean = value => value.replace(/\f/g, '\n').split('\n').map(line => line.trim()).filter(line => line && !/^\d+$/.test(line)).join(' ').replace(/\s+/g, ' ').trim();
const content = value => [{ type: 'paragraph', children: [{ type: 'text', text: clean(value) }] }];
const lyricContent = value => value
  .replace(/\f/g, '\n')
  .split(/\n\s*\n/)
  .map(group => group.split('\n').map(line => line.trim()).filter(line => line && !/^\d+$/.test(line)).join('\n'))
  .filter(Boolean)
  .map(text => ({ type: 'paragraph', children: [{ type: 'text', text }] }));
const resolved = value => ({
  content: content(value),
  source: 'manual',
  retrievedAt: '2026-06-04T20:47:57-07:00',
  attribution: 'THE HOLY BIBLE, NEW INTERNATIONAL VERSION®, NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by permission. All rights reserved worldwide.'
});

block('opening-hymn').title = 'To God Be the Glory (CW 399)';
block('opening-hymn').contentOverride = lyricContent(between('OPENING HYMN: To God Be The Glory (CW 399)', 'INVOCATION'));
block('song-of-praise').contentOverride = lyricContent(between('SONG OF PRAISE: Give Thanks', 'PRAYER OF THE DAY'));
block('song-of-praise').layout = { pageBreakBefore: true };
const firstReadingText = 'Now Moses was tending' + between('Now Moses was tending', 'PSALM: I Will Wait For You (Psalm 130)');
const firstReadingPageBreak = firstReadingText.indexOf('on fire it did not burn up.');
block('first-reading').resolved = resolved(firstReadingText.slice(0, firstReadingPageBreak));
document.blocks = document.blocks.filter(item => item.id !== 'first-reading-continuation');
const firstReadingIndex = document.blocks.findIndex(item => item.id === 'first-reading');
document.blocks.splice(firstReadingIndex + 1, 0, {
  ...block('first-reading'),
  id: 'first-reading-continuation',
  label: 'First Reading (continued)',
  caption: undefined,
  resolved: resolved(firstReadingText.slice(firstReadingPageBreak)),
  layout: { pageBreakBefore: true }
});
block('gospel').resolved = resolved('As Jesus went on from there' + between('As Jesus went on from there', 'HYMN OF THE DAY: Chief of Sinners Though I Be (CW 385)'));
block('hymn-of-the-day').title = 'Chief of Sinners Though I Be (CW 385)';
const hymnContent = lyricContent(between('HYMN OF THE DAY: Chief of Sinners Though I Be (CW 385)', 'SERMON: 1 Timothy 1:12-17'));
block('hymn-of-the-day').contentOverride = hymnContent.slice(0, 2);
document.blocks = document.blocks.filter(item => item.id !== 'hymn-of-the-day-continuation');
const hymnIndex = document.blocks.findIndex(item => item.id === 'hymn-of-the-day');
document.blocks.splice(hymnIndex + 1, 0, {
  ...block('hymn-of-the-day'),
  id: 'hymn-of-the-day-continuation',
  label: 'Hymn of the Day (continued)',
  contentOverride: hymnContent.slice(2),
  layout: { pageBreakBefore: true }
});
block('sermon').resolved = resolved('I thank Christ Jesus our Lord' + between('I thank Christ Jesus our Lord', 'CONFESSION OF FAITH: Apostles’ Creed'));
block('confession-of-faith').contentOverride = content(between('CONFESSION OF FAITH: Apostles’ Creed', ' The Prayers'));
block('prayer-2').contentOverride = content(between('LORD’S PRAYER', 'BLESSING'));
block('copyrightblock').extra = content('To God Be The Glory, Text, Tune, Setting: public domain. ' + between('To God Be The Glory, Text, Tune, Setting: public domain.', 'CLOSING SONG: His Mercy Is More'));
block('copyrightblock').suppressGeneratedNotices = true;

Object.assign(block('psalm'), {
  title: 'I Will Wait for You (Psalm 130)',
  libraryItemVersion: 1,
  asset: { path: 'assets/example_2026-06-07/psalm-130-part-1.png', mediaType: 'image/png', alt: 'I Will Wait for You score, first portion' },
  assetHeightIn: 2.15
});
document.blocks = document.blocks.filter(item => item.id !== 'psalm-continuation');
const psalmIndex = document.blocks.findIndex(item => item.id === 'psalm');
document.blocks.splice(psalmIndex + 1, 0, {
  id: 'psalm-continuation',
  type: 'song',
  songType: 'psalm',
  libraryItemId: '130',
  libraryItemVersion: 1,
  title: 'I Will Wait for You (Psalm 130)',
  selection: { mode: 'all' },
  renderMode: 'asset',
  showHeading: false,
  assetHeightIn: 5.75,
  asset: { path: 'assets/example_2026-06-07/psalm-130-part-2.png', mediaType: 'image/png', alt: 'I Will Wait for You score, continued' },
  layout: { pageBreakBefore: true }
});
block('children-s-message').layout = { pageBreakBefore: true };
block('sermon').layout = undefined;
block('the-prayers').layout = { pageBreakBefore: true };
Object.assign(block('closing-song'), { libraryItemVersion: 1, title: 'His Mercy Is More', assetHeightIn: 5.2, layout: { pageBreakBefore: true } });
block('announcements').layout = { pageBreakBefore: true };
block('announcements').items = block('announcements').items.filter(item => !['requests-for-prayer-and-care', 'giving-to-lamb-of-god'].includes(item.id));
block('announcements').items.push(
  {
    id: 'requests-for-prayer-and-care',
    title: 'Requests for Prayer and Care',
    content: content('If you wish to request prayer for yourself or someone else, you may fill out the request on the Communication Card or use this QR code. This is also a way to reach the Caring Committee if you need other assistance as well.'),
    asset: { path: 'assets/example_2026-06-07/prayer-care-qr.png', mediaType: 'image/png', alt: 'Prayer and care request QR code' },
    assetSide: 'right'
  },
  {
    id: 'giving-to-lamb-of-god',
    title: 'Giving to Lamb of God',
    content: content('If you wish to give your offering to Lamb of God online, this QR code is provided for your convenience. Several types of payment are accepted on this secure site. Thank you for your financial gifts to assist with the ministry of Lamb of God.'),
    asset: { path: 'assets/example_2026-06-07/giving-qr.png', mediaType: 'image/png', alt: 'Online giving QR code' },
    assetSide: 'left'
  }
);
const firstEntry = block('responsivereading-3').entries[0];
firstEntry.content = [
  { type: 'paragraph', children: [{ type: 'text', text: 'If we say we have no sin, we deceive ourselves, and the truth is not in us. But if we confess our sins, God who is faithful and just will forgive our sins and cleanse us from all unrighteousness.' }] },
  { type: 'paragraph', align: 'right', children: [{ type: 'text', text: '1 John 1:8-9', marks: ['italic'] }] },
  ...firstEntry.content.filter(item => !item.children?.some(child => child.text === '1 John 1:8-9') && !item.children?.some(child => child.text?.startsWith('If we say we have no sin')))
];
document.sourceNotes = 'Faithfully transcribed from example_bulletins/6 7 2026.pdf. Music notation and QR codes remain source assets; all other bulletin content is structured and editable.';
document.updatedAt = '2026-07-22T00:00:00.000Z';
await writeFile('example_bulletin.json', JSON.stringify(document, null, 2) + '\n');
