/** Normalizes a display-style reference without collapsing discontiguous verse ranges. */
export function normalizeScriptureReference(value: string): string {
  let reference = value.trim();
  if (reference.startsWith('(') && reference.endsWith(')')) reference = reference.slice(1, -1).trim();
  return reference
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ');
}

const singleChapterBooks = new Set([
  'obadiah', 'obad',
  'philemon', 'philem', 'phlm', 'phm',
  '2 john', '2 jn', 'ii john', 'ii jn',
  '3 john', '3 jn', 'iii john', 'iii jn',
  'jude',
]);

/** Rejects references that Bible sites may silently reinterpret as verses. */
export function strictScriptureReferenceIssue(value: string): string | undefined {
  const reference = normalizeScriptureReference(value);
  const chapterOnly = /^(.+?)\s+(\d+(?:\s*[-,]\s*\d+)*)$/.exec(reference);
  if (!chapterOnly) return undefined;
  const book = chapterOnly[1].toLocaleLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  if (!singleChapterBooks.has(book) || chapterOnly[2] === '1') return undefined;
  return `${chapterOnly[1]} has only one chapter. Enter an explicit chapter-and-verse reference, such as “${chapterOnly[1]} 1:${chapterOnly[2].replace(/\s+/g, '')}”.`;
}
