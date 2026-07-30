import { describe, expect, it } from 'vitest';
import {
  churchCalendarIssues,
  churchEventDates,
  churchEventsForDate,
  churchLectionaryYear,
  gregorianEaster,
  migrateChurchWeekNames,
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
});
