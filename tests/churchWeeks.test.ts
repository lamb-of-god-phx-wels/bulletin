import { describe, expect, it } from 'vitest';
import { churchWeekDisplayName, churchWeekForDate, importChurchWeekCalendar, validChurchWeekCalendar, validChurchWeekNames } from '../src/shared/churchWeeks';

describe('church-week names', () => {
  const names = [{ sourceName: 'Epiphany 2', displayName: 'Second Sunday after Epiphany' }];

  it('expands source names without changing free-form values', () => {
    expect(churchWeekDisplayName(' epiphany 2 ', names)).toBe('Second Sunday after Epiphany');
    expect(churchWeekDisplayName('Second Sunday after Epiphany', names)).toBe('Second Sunday after Epiphany');
    expect(churchWeekDisplayName('Festival of St. Michael', names)).toBe('Festival of St. Michael');
  });

  it('trims entries and removes incomplete or duplicate source names', () => {
    expect(validChurchWeekNames([
      { sourceName: ' Epiphany 2 ', displayName: ' Second Sunday after Epiphany ' },
      { sourceName: 'epiphany 2', displayName: 'Duplicate' },
      { sourceName: '', displayName: 'Incomplete' }
    ])).toEqual(names);
  });

  it('imports ISO, short, natural-language, tabular, and HTML date/name pairs', () => {
    expect(importChurchWeekCalendar(`
      2026-08-02, Pentecost 10
      8/9/2026\tPentecost 11
      Sunday, August 16, 2026 — Pentecost 12
      <h2>Pentecost 13</h2><p>August 23, 2026</p>
    `)).toEqual([
      { date: '2026-08-02', sourceName: 'Pentecost 10' },
      { date: '2026-08-09', sourceName: 'Pentecost 11' },
      { date: '2026-08-16', sourceName: 'Pentecost 12' },
      { date: '2026-08-23', sourceName: 'Pentecost 13' }
    ]);
  });

  it('deduplicates imported dates and resolves their preferred display names', () => {
    const calendar = validChurchWeekCalendar([
      { date: '8/2/2026', sourceName: 'Old name' },
      { date: '2026-08-02', sourceName: 'Epiphany 2' },
      { date: 'invalid', sourceName: 'Ignored' }
    ]);
    expect(calendar).toEqual([{ date: '2026-08-02', sourceName: 'Epiphany 2' }]);
    expect(churchWeekForDate('2026-08-02', calendar, names)).toBe('Second Sunday after Epiphany');
    expect(churchWeekForDate('2026-08-09', calendar, names)).toBeUndefined();
  });
});
