import { describe, expect, it } from 'vitest';
import { filterBulletins, sortedBulletins, type BulletinRecord } from '../src/shared/bulletins';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';

const record = (date: string, title: string, path = `bulletins/${date}/bulletin.json`): BulletinRecord => {
  const document = createBulletin(defaultTemplate, date);
  document.info.title = title;
  return { path, document };
};

describe('bulletin selection', () => {
  const records = [
    record('2025-12-24', 'Christmas Eve'),
    record('2026-07-19', 'Mercy for All'),
    record('2026-07-26', 'The Good Shepherd')
  ];

  it('sorts the complete history newest first without mutating it', () => {
    expect(sortedBulletins(records).map(item => item.document.info.date)).toEqual(['2026-07-26', '2026-07-19', '2025-12-24']);
    expect(records[0].document.info.date).toBe('2025-12-24');
  });

  it('searches bulletin metadata with multiple terms', () => {
    records[1].document.info.series = 'Summer Grace';
    expect(filterBulletins(records, 'summer mercy').map(item => item.document.info.title)).toEqual(['Mercy for All']);
    expect(filterBulletins(records, '2025').map(item => item.document.info.title)).toEqual(['Christmas Eve']);
    expect(filterBulletins(records, 'missing')).toEqual([]);
  });
});
