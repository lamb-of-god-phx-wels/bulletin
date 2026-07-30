import { describe, expect, it } from 'vitest';
import {
  churchCalendarIssues,
  churchEventDates,
  churchEventDisplayName,
  churchEventsForDate,
  churchLectionaryYear,
  gregorianEaster,
  migrateChurchWeekNames,
  upgradeWelsCalendarPresets,
  welsCalendarPreset
} from '../src/shared/churchCalendar';
import type { ChurchCalendarEvent } from '../src/shared/types';

const oneTime = (id: string, name: string, date: string, priority: number): ChurchCalendarEvent => ({
  id,
  name,
  enabled: true,
  priority,
  rules: [{ kind: 'once', date }]
});

describe('church calendar', () => {
  it('computes Easter and the movable WELS calendar deterministically', () => {
    expect(gregorianEaster(2024)).toBe('2024-03-31');
    expect(gregorianEaster(2025)).toBe('2025-04-20');
    expect(gregorianEaster(2026)).toBe('2026-04-05');

    const preset = welsCalendarPreset();
    expect(churchEventDates('ash-wednesday', 2026, preset)).toEqual(['2026-02-18']);
    expect(churchEventDates('pentecost', 2026, preset)).toEqual(['2026-05-24']);
    expect(churchEventDates('advent-1', 2026, preset)).toEqual(['2026-11-29']);
    expect(churchEventDates('reformation', 2026, preset)).toEqual(['2026-10-25']);
    expect(churchEventDates('all-saints', 2026, preset)).toEqual(['2026-11-01']);
    expect(churchEventDates('last-sunday-church-year', 2026, preset)).toEqual(['2026-11-22']);
  });

  it('keeps every movable rule valid from 1900 through 2199', () => {
    const preset = welsCalendarPreset();
    expect(churchCalendarIssues(preset)).toEqual([]);
    const day = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
    const daysBetween = (left: string, right: string) =>
      (Date.parse(`${left}T12:00:00Z`) - Date.parse(`${right}T12:00:00Z`)) / 86_400_000;
    const addDays = (date: string, count: number) =>
      new Date(Date.parse(`${date}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

    for (let year = 1900; year <= 2199; year += 1) {
      const easter = churchEventDates('easter', year, preset)[0];
      const pentecost = churchEventDates('pentecost', year, preset)[0];
      const trinity = churchEventDates('holy-trinity', year, preset)[0];
      const baptism = churchEventDates('baptism-of-our-lord', year, preset)[0];
      const transfiguration = churchEventDates('transfiguration', year, preset)[0];
      const advent = churchEventDates('advent-1', year, preset)[0];
      const lastSunday = churchEventDates('last-sunday-church-year', year, preset)[0];
      expect(easter.slice(5) >= '03-22').toBe(true);
      expect(easter.slice(5) <= '04-25').toBe(true);
      expect(day(easter)).toBe(0);
      expect(daysBetween(pentecost, easter)).toBe(49);
      expect(daysBetween(trinity, easter)).toBe(56);
      expect(day(baptism)).toBe(0);
      expect(baptism.slice(5) >= '01-07' && baptism.slice(5) <= '01-13').toBe(true);
      expect(daysBetween(transfiguration, easter)).toBe(-49);
      expect(day(advent)).toBe(0);
      expect(advent.slice(5) >= '11-27').toBe(true);
      expect(advent.slice(5) <= '12-03').toBe(true);
      expect(lastSunday.slice(5) >= '11-20').toBe(true);
      expect(lastSunday.slice(5) <= '11-26').toBe(true);

      const properDates = preset
        .filter(event => event.id.startsWith('proper-'))
        .flatMap(event => churchEventDates(event.id, year, preset).map(date => ({ event, date })));
      expect(new Set(properDates.map(item => item.date)).size).toBe(properDates.length);
      for (const { event, date } of properDates) {
        expect(day(date)).toBe(0);
        expect(date > trinity).toBe(true);
        expect(churchEventDisplayName(event, date, preset)).toMatch(/^\w+(?:-\w+)? Sunday After Pentecost$/);
      }
      for (let date = addDays(trinity, 7); date < lastSunday; date = addDays(date, 7)) {
        expect(properDates.filter(item => item.date === date)).toHaveLength(1);
      }
      for (let ordinal = 2; ordinal <= 8; ordinal += 1) {
        for (const date of churchEventDates(`epiphany-${ordinal}`, year, preset)) expect(date < transfiguration).toBe(true);
      }
      for (const date of churchEventDates('second-sunday-after-christmas', year, preset)) {
        expect(date.slice(5) >= '01-02' && date.slice(5) <= '01-05').toBe(true);
      }
      for (const calendarEvent of preset) for (const date of churchEventDates(calendarEvent.id, year, preset)) {
        expect(date.startsWith(`${year}-`)).toBe(true);
        expect(new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10)).toBe(date);
      }
    }
  });

  it('uses bounded CW21 Propers but displays their Sunday-after-Pentecost ordinal', () => {
    const preset = welsCalendarPreset();
    expect(churchEventDates('proper-3', 2022, preset)).toEqual([]);
    expect(churchEventDates('proper-4', 2022, preset)).toEqual([]);
    const proper5 = preset.find(event => event.id === 'proper-5')!;
    expect(churchEventDates(proper5.id, 2026, preset)).toEqual(['2026-06-07']);
    expect(churchEventDisplayName(proper5, '2026-06-07', preset)).toBe('Second Sunday After Pentecost');
    expect(preset.some(event => event.id === 'proper-29')).toBe(false);
  });

  it('changes lectionary year on the First Sunday in Advent', () => {
    expect(churchLectionaryYear('2026-11-28')).toBe('A');
    expect(churchLectionaryYear('2026-11-29')).toBe('B');
  });

  it('uses explicit priority and stable tie-breaking for bulletin defaults', () => {
    const events = [
      oneTime('ordinary', 'Ordinary Sunday', '2026-10-31', 40),
      oneTime('reformation', 'Reformation', '2026-10-31', 90),
      oneTime('alternate', 'Alternate festival', '2026-10-31', 90)
    ];
    expect(churchEventsForDate('2026-10-31', events).map(event => event.id)).toEqual([
      'alternate',
      'reformation',
      'ordinary'
    ]);
  });

  it('does not spill a missing fifth weekday into the next month', () => {
    const event: ChurchCalendarEvent = {
      id: 'fifth-monday',
      name: 'Fifth Monday',
      enabled: true,
      priority: 1,
      rules: [{ kind: 'nthWeekday', month: 2, weekday: 1, ordinal: 5 }]
    };
    expect(churchEventDates(event.id, 2026, [event])).toEqual([]);
  });

  it('reports duplicate IDs, missing anchors, and dependency cycles', () => {
    const events: ChurchCalendarEvent[] = [
      { id: 'a', name: 'A', enabled: true, priority: 1, rules: [{ kind: 'relativeDays', eventId: 'b', days: 1 }] },
      { id: 'b', name: 'B', enabled: true, priority: 1, rules: [{ kind: 'relativeDays', eventId: 'a', days: 1 }] },
      { id: 'a', name: 'Duplicate', enabled: true, priority: 1, rules: [{ kind: 'relativeDays', eventId: 'missing', days: 1 }] }
    ];
    const messages = churchCalendarIssues(events).map(issue => issue.message);
    expect(messages.some(message => message.includes('Duplicate event ID'))).toBe(true);
    expect(messages.some(message => message.includes('missing event'))).toBe(true);
    expect(messages.some(message => message.includes('dependency cycle'))).toBe(true);
  });

  it('turns existing display overrides into editable calendar assets', () => {
    const migrated = migrateChurchWeekNames([
      { sourceName: 'Proper 12', displayName: 'Ninth Sunday after Pentecost' },
      { sourceName: 'Local Anniversary', displayName: 'Church Anniversary' }
    ]);
    expect(migrated.find(event => event.id === 'proper-12')?.name).toBe('Ninth Sunday after Pentecost');
    expect(migrated.find(event => event.aliases?.includes('Local Anniversary'))).toMatchObject({
      name: 'Church Anniversary',
      enabled: false,
      needsRule: true,
      rules: []
    });
  });

  it('upgrades untouched version-one presets without overwriting a custom display name', () => {
    const upgraded = upgradeWelsCalendarPresets([
      {
        id: 'proper-5',
        name: 'Second Sunday after Pentecost',
        enabled: true,
        priority: 40,
        rules: [{ kind: 'weekdayOnOrAfter', month: 6, day: 5, weekday: 0 }],
        aliases: ['Pentecost 4']
      },
      {
        id: 'proper-29',
        name: 'Proper 29',
        enabled: true,
        priority: 40,
        rules: [{ kind: 'weekdayOnOrAfter', month: 11, day: 20, weekday: 0 }],
        aliases: ['Pentecost 28']
      },
      {
        id: 'reformation',
        name: 'Reformation',
        enabled: true,
        priority: 90,
        rules: [{ kind: 'annualDate', month: 10, day: 31 }],
        aliases: []
      }
    ], true);
    expect(upgraded.find(event => event.id === 'proper-5')).toMatchObject({
      name: 'Second Sunday after Pentecost',
      rules: [expect.objectContaining({ kind: 'weekdayInDateRange', afterEventId: 'holy-trinity' })]
    });
    expect(upgraded.find(event => event.id === 'proper-5')?.nameMode).toBeUndefined();
    expect(upgraded.some(event => event.id === 'proper-29')).toBe(false);
    expect(upgraded.find(event => event.id === 'reformation')?.rules).toEqual([
      { kind: 'nthWeekday', month: 10, weekday: 0, ordinal: -1 }
    ]);
    expect(upgraded.some(event => event.id === 'last-sunday-church-year')).toBe(true);
  });
});
