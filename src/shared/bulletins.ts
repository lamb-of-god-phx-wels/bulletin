import type { WorkspaceSummary } from './types.js';

export type BulletinRecord = WorkspaceSummary['bulletins'][number];

export function sortedBulletins(records: BulletinRecord[]): BulletinRecord[] {
  return [...records].sort((left, right) =>
    right.document.info.date.localeCompare(left.document.info.date) ||
    right.document.updatedAt.localeCompare(left.document.updatedAt) ||
    left.path.localeCompare(right.path)
  );
}

export function filterBulletins(records: BulletinRecord[], query: string): BulletinRecord[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const sorted = sortedBulletins(records);
  if (!terms.length) return sorted;
  return sorted.filter(({ document, path }) => {
    const searchable = [
      document.info.date,
      document.info.title,
      document.info.series,
      document.info.churchWeek,
      document.church.name,
      path
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
