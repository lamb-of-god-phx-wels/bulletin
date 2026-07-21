import type { BulletinDocumentV1, LibraryManifestV1, ValidationIssue } from './types.js';

export function validateBulletin(value: unknown, library?: LibraryManifestV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object') return [{ path: '', message: 'Bulletin must be an object.' }];
  const doc = value as Partial<BulletinDocumentV1>;
  if (doc.schemaVersion !== 1) issues.push({ path: '/schemaVersion', message: 'Expected schema version 1.' });
  if (!doc.id) issues.push({ path: '/id', message: 'A stable bulletin ID is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.info?.date ?? '')) issues.push({ path: '/info/date', message: 'Use an ISO date (YYYY-MM-DD).' });
  if (!Array.isArray(doc.blocks)) issues.push({ path: '/blocks', message: 'Blocks must be an array.' });
  const ids = new Set<string>();
  doc.blocks?.forEach((block, index) => {
    if (!block.id) issues.push({ path: `/blocks/${index}/id`, message: 'Every block needs an ID.' });
    else if (ids.has(block.id)) issues.push({ path: `/blocks/${index}/id`, message: `Duplicate block ID: ${block.id}` });
    ids.add(block.id);
    if (block.type === 'scriptureReading' && !block.reference) issues.push({ path: `/blocks/${index}/reference`, message: 'Enter a Scripture reference.' });
    else if (block.type === 'scriptureReading' && !block.resolved) issues.push({ path: `/blocks/${index}/resolved`, message: 'Fetch or paste the approved passage text.' });
    if ((block.type === 'song' || block.type === 'libraryText') && !block.libraryItemId) issues.push({ path: `/blocks/${index}/libraryItemId`, message: 'Choose an approved library item.' });
    if ((block.type === 'song' || block.type === 'libraryText') && library && !library.items.some(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion))) issues.push({ path: `/blocks/${index}/libraryItemId`, message: `Library item “${block.libraryItemId}” version ${block.libraryItemVersion ?? 'latest'} is unavailable.` });
    if (block.type === 'song' && block.renderMode === 'asset' && !block.asset && library && !library.items.some(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion) && item.assets?.length)) issues.push({ path: `/blocks/${index}/asset`, message: 'Choose a music image or PDF.' });
    if (block.type === 'fullPageAsset' && !block.asset?.path) issues.push({ path: `/blocks/${index}/asset/path`, message: 'Choose an asset.' });
  });
  return issues;
}
