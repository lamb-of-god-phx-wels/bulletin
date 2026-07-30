import type { ChurchCalendarEvent, ChurchEventRule, ChurchLectionaryYear } from './types.js';

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, 12));
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS));
const validMonthDay = (month: number, day: number) => {
  const date = utcDate(2000, month, day);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const validIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && iso(date) === value;
};
const ruleEventIds = (rule: ChurchEventRule) => {
  if (rule.kind === 'relativeDays') return [rule.eventId, ...(rule.beforeEventId ? [rule.beforeEventId] : [])];
  if (rule.kind === 'weekdayRelative') return [rule.eventId];
  if (rule.kind === 'weekdayInDateRange' && rule.afterEventId) return [rule.afterEventId];
  return [];
};

export function gregorianEaster(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return iso(utcDate(year, month, day));
}

export function churchLectionaryYear(date: string): ChurchLectionaryYear {
  const parsed = new Date(`${date}T12:00:00Z`);
  const calendarYear = parsed.getUTCFullYear();
  const christmas = utcDate(calendarYear, 12, 25);
  const firstAdvent = addDays(iso(christmas), -((((christmas.getUTCDay() - 0 + 6) % 7) + 1) + 21));
  const churchYear = date >= firstAdvent ? calendarYear + 1 : calendarYear;
  return (['A', 'B', 'C'] as const)[((churchYear - 2026) % 3 + 3) % 3];
}

function nthWeekday(year: number, month: number, weekday: number, ordinal: number) {
  if (ordinal === -1) {
    const last = utcDate(year, month + 1, 0);
    return iso(utcDate(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
  }
  const first = utcDate(year, month, 1);
  const result = utcDate(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (ordinal - 1) * 7);
  return result.getUTCMonth() === month - 1 ? iso(result) : undefined;
}

export interface ChurchCalendarIssue { eventId: string; message: string }

export function churchCalendarIssues(events: ChurchCalendarEvent[]): ChurchCalendarIssue[] {
  const issues: ChurchCalendarIssue[] = [];
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.id.trim()) issues.push({ eventId: event.id, message: 'Every event needs a stable ID.' });
    if (ids.has(event.id)) issues.push({ eventId: event.id, message: `Duplicate event ID: ${event.id}` });
    ids.add(event.id);
    if (!event.name.trim()) issues.push({ eventId: event.id, message: 'Event name is required.' });
    if (!Number.isFinite(event.priority)) issues.push({ eventId: event.id, message: 'Priority must be a finite number.' });
    if (event.enabled && !event.rules.length) issues.push({ eventId: event.id, message: 'Enabled events need at least one date rule.' });
    for (const rule of event.rules) {
      const months = 'month' in rule ? [rule.month] : rule.kind === 'weekdayInDateRange' ? [rule.startMonth, rule.endMonth] : [];
      const days = 'day' in rule ? [rule.day] : rule.kind === 'weekdayInDateRange' ? [rule.startDay, rule.endDay] : [];
      if (months.some(month => month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))) issues.push({ eventId: event.id, message: 'Rule month must be from 1 through 12.' });
      if (days.some(day => !Number.isInteger(day) || day! < 1 || day! > 31)) issues.push({ eventId: event.id, message: 'Rule day must be from 1 through 31.' });
      if (rule.kind === 'annualDate' && !validMonthDay(rule.month, rule.day)) issues.push({ eventId: event.id, message: 'Annual rule date does not exist.' });
      if (rule.kind === 'weekdayOnOrAfter' && !validMonthDay(rule.month, rule.day)) issues.push({ eventId: event.id, message: 'Rule start date does not exist.' });
      if (rule.kind === 'weekdayInDateRange' && (!validMonthDay(rule.startMonth, rule.startDay) || !validMonthDay(rule.endMonth, rule.endDay))) issues.push({ eventId: event.id, message: 'Rule date range contains a date that does not exist.' });
      if ('weekday' in rule && (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6)) issues.push({ eventId: event.id, message: 'Rule weekday must be from Sunday through Saturday.' });
      if (rule.kind === 'once' && !validIsoDate(rule.date)) issues.push({ eventId: event.id, message: 'One-time rules need a valid date.' });
      if (rule.kind === 'relativeDays' && !Number.isInteger(rule.days)) issues.push({ eventId: event.id, message: 'Relative day offsets must be whole numbers.' });
      for (const dependency of ruleEventIds(rule)) if (!events.some(candidate => candidate.id === dependency)) issues.push({ eventId: event.id, message: `Rule refers to missing event ${dependency}.` });
    }
  }
  const visit = (id: string, path: string[]) => {
    if (path.includes(id)) { issues.push({ eventId: id, message: `Event rule dependency cycle: ${[...path, id].join(' → ')}` }); return; }
    const event = events.find(candidate => candidate.id === id);
    for (const rule of event?.rules ?? []) for (const dependency of ruleEventIds(rule)) visit(dependency, [...path, id]);
  };
  for (const event of events) visit(event.id, []);
  return issues.filter((issue, index, all) => all.findIndex(candidate => candidate.eventId === issue.eventId && candidate.message === issue.message) === index);
}

export function churchEventDates(eventId: string, year: number, events: ChurchCalendarEvent[], stack: string[] = []): string[] {
  if (stack.includes(eventId)) return [];
  const event = events.find(candidate => candidate.id === eventId);
  if (!event?.enabled) return [];
  const resolveRule = (rule: ChurchEventRule): string[] => {
    if (rule.kind === 'once') return rule.date.startsWith(`${year}-`) ? [rule.date] : [];
    if (rule.kind === 'annualDate') {
      const date = utcDate(year, rule.month, rule.day);
      return date.getUTCMonth() === rule.month - 1 ? [iso(date)] : [];
    }
    if (rule.kind === 'easter') return [gregorianEaster(year)];
    if (rule.kind === 'nthWeekday') return (rule.month ? [rule.month] : Array.from({ length: 12 }, (_, index) => index + 1))
      .map(month => nthWeekday(year, month, rule.weekday, rule.ordinal))
      .filter((date): date is string => Boolean(date));
    if (rule.kind === 'weekdayOnOrAfter') {
      const start = utcDate(year, rule.month, rule.day);
      return [addDays(iso(start), (rule.weekday - start.getUTCDay() + 7) % 7)];
    }
    if (rule.kind === 'weekdayInDateRange') {
      const start = utcDate(year, rule.startMonth, rule.startDay);
      const endYear = rule.endMonth < rule.startMonth ? year + 1 : year;
      const end = utcDate(endYear, rule.endMonth, rule.endDay);
      const first = addDays(iso(start), (rule.weekday - start.getUTCDay() + 7) % 7);
      if (first > iso(end)) return [];
      if (!rule.afterEventId) return first.startsWith(`${year}-`) ? [first] : [];
      const anchors = churchEventDates(rule.afterEventId, year, events, [...stack, eventId]);
      return anchors.some(anchor => first > anchor) && first.startsWith(`${year}-`) ? [first] : [];
    }
    const anchors = [year - 1, year, year + 1].flatMap(anchorYear => churchEventDates(rule.eventId, anchorYear, events, [...stack, eventId]));
    if (rule.kind === 'relativeDays') {
      const dates = anchors.map(anchor => addDays(anchor, rule.days)).filter(date => date.startsWith(`${year}-`));
      if (!rule.beforeEventId) return dates;
      const limits = churchEventDates(rule.beforeEventId, year, events, [...stack, eventId]);
      return dates.filter(date => limits.some(limit => date < limit));
    }
    return anchors.map(anchor => {
      const anchorDate = new Date(`${anchor}T12:00:00Z`);
      const distance = rule.direction === 'before'
        ? -(((anchorDate.getUTCDay() - rule.weekday + 6) % 7) + 1 + (rule.ordinal - 1) * 7)
        : ((rule.weekday - anchorDate.getUTCDay() + 6) % 7) + 1 + (rule.ordinal - 1) * 7;
      return addDays(anchor, distance);
    }).filter(date => date.startsWith(`${year}-`));
  };
  return [...new Set(event.rules.flatMap(resolveRule))].filter(date => !event.lectionaryYears?.length || event.lectionaryYears.includes(churchLectionaryYear(date))).sort();
}

export function churchEventsForDate(date: string, events: ChurchCalendarEvent[]): ChurchCalendarEvent[] {
  const year = Number(date.slice(0, 4));
  if (!Number.isInteger(year)) return [];
  return events.filter(event => event.enabled && churchEventDates(event.id, year, events).includes(date))
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

const ordinalNames = [
  '', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth',
  'Eighteenth', 'Nineteenth', 'Twentieth', 'Twenty-First', 'Twenty-Second', 'Twenty-Third',
  'Twenty-Fourth', 'Twenty-Fifth', 'Twenty-Sixth', 'Twenty-Seventh', 'Twenty-Eighth'
];

export function churchEventDisplayName(event: ChurchCalendarEvent, date: string, events: ChurchCalendarEvent[]): string {
  if (event.nameMode !== 'sundayAfterPentecost') return event.name;
  const year = Number(date.slice(0, 4));
  const pentecost = churchEventDates('pentecost', year, events)[0];
  if (!pentecost) return event.name;
  const distance = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${pentecost}T12:00:00Z`)) / DAY_MS);
  const ordinal = distance / 7;
  return Number.isInteger(ordinal) && ordinal > 0 && ordinal < ordinalNames.length
    ? `${ordinalNames[ordinal]} Sunday After Pentecost`
    : event.name;
}

const event = (id: string, name: string, priority: number, rules: ChurchEventRule[], aliases: string[] = []): ChurchCalendarEvent =>
  ({ id, name, priority, rules, aliases, enabled: true });
const relative = (id: string, name: string, days: number, priority = 60, anchor = 'easter') => event(id, name, priority, [{ kind: 'relativeDays', eventId: anchor, days }]);
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
    : value;
const equivalent = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const PROPER_RANGES = [
  [5, 24, 5, 28], [5, 29, 6, 4], [6, 5, 6, 11], [6, 12, 6, 18], [6, 19, 6, 25],
  [6, 26, 7, 2], [7, 3, 7, 9], [7, 10, 7, 16], [7, 17, 7, 23], [7, 24, 7, 30],
  [7, 31, 8, 6], [8, 7, 8, 13], [8, 14, 8, 20], [8, 21, 8, 27], [8, 28, 9, 3],
  [9, 4, 9, 10], [9, 11, 9, 17], [9, 18, 9, 24], [9, 25, 10, 1], [10, 2, 10, 8],
  [10, 9, 10, 15], [10, 16, 10, 22], [10, 23, 10, 29], [10, 30, 11, 5],
  [11, 6, 11, 12], [11, 13, 11, 19]
] as const;
const LEGACY_PROPER_STARTS = [[5, 24], [5, 29], [6, 5], [6, 12], [6, 19], [6, 26], [7, 3], [7, 10], [7, 17], [7, 24], [7, 31], [8, 7], [8, 14], [8, 21], [8, 28], [9, 4], [9, 11], [9, 18], [9, 25], [10, 2], [10, 9], [10, 16], [10, 23], [10, 30], [11, 6], [11, 13], [11, 20]] as const;

export const WELS_CALENDAR_PRESET_VERSION = 2;
export const welsCalendarPreset = (): ChurchCalendarEvent[] => {
  const events: ChurchCalendarEvent[] = [
    event('christmas', 'The Nativity of Our Lord (Christmas Day)', 100, [{ kind: 'annualDate', month: 12, day: 25 }], ['Christmas', 'Christmas Day']),
    event('advent-1', 'First Sunday in Advent', 70, [{ kind: 'weekdayRelative', eventId: 'christmas', weekday: 0, ordinal: 4, direction: 'before' }], ['Advent 1']),
    event('advent-2', 'Second Sunday in Advent', 70, [{ kind: 'weekdayRelative', eventId: 'christmas', weekday: 0, ordinal: 3, direction: 'before' }], ['Advent 2']),
    event('advent-3', 'Third Sunday in Advent', 70, [{ kind: 'weekdayRelative', eventId: 'christmas', weekday: 0, ordinal: 2, direction: 'before' }], ['Advent 3']),
    event('advent-4', 'Fourth Sunday in Advent', 70, [{ kind: 'weekdayRelative', eventId: 'christmas', weekday: 0, ordinal: 1, direction: 'before' }], ['Advent 4']),
    event('christmas-eve', 'The Nativity of Our Lord (Christmas Eve)', 100, [{ kind: 'annualDate', month: 12, day: 24 }], ['Christmas Eve']),
    event('sunday-after-christmas', 'First Sunday after Christmas', 60, [{ kind: 'weekdayRelative', eventId: 'christmas', weekday: 0, ordinal: 1, direction: 'after' }]),
    event('second-sunday-after-christmas', 'Second Sunday after Christmas', 60, [{ kind: 'weekdayInDateRange', startMonth: 1, startDay: 2, endMonth: 1, endDay: 5, weekday: 0 }]),
    event('name-of-jesus', 'Circumcision and Name of Jesus', 90, [{ kind: 'annualDate', month: 1, day: 1 }], ['The Name of Jesus']),
    event('epiphany', 'The Epiphany of Our Lord', 100, [{ kind: 'annualDate', month: 1, day: 6 }], ['Epiphany']),
    event('baptism-of-our-lord', 'The First Sunday after the Epiphany—The Baptism of Our Lord', 80, [{ kind: 'weekdayRelative', eventId: 'epiphany', weekday: 0, ordinal: 1, direction: 'after' }], ['The Baptism of Our Lord']),
    event('easter', 'The Resurrection of Our Lord (Easter Day)', 110, [{ kind: 'easter' }], ['Easter Sunday', 'Easter']),
    relative('transfiguration', 'The Last Sunday after the Epiphany—The Transfiguration of Our Lord', -49, 80),
    relative('ash-wednesday', 'Ash Wednesday', -46, 100),
    ...Array.from({ length: 5 }, (_, index) => relative(`lent-${index + 1}`, `${['First', 'Second', 'Third', 'Fourth', 'Fifth'][index]} Sunday in Lent`, -42 + index * 7, 70, 'easter')),
    relative('palm-sunday', 'The Sixth Sunday in Lent—Palm Sunday', -7, 100),
    relative('maundy-thursday', 'Holy Thursday', -3, 100),
    relative('good-friday', 'Good Friday', -2, 110),
    ...Array.from({ length: 6 }, (_, index) => relative(`easter-${index + 2}`, `${['Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'][index]} Sunday of Easter`, 7 + index * 7, 70)),
    relative('ascension', 'The Ascension of Our Lord', 39, 100),
    relative('pentecost', 'The Day of Pentecost', 49, 110),
    relative('holy-trinity', 'The First Sunday after Pentecost—Holy Trinity', 56, 100),
    event('reformation', 'Reformation', 90, [{ kind: 'nthWeekday', month: 10, weekday: 0, ordinal: -1 }], ['Reformation Day']),
    event('all-saints', 'All Saints’ Sunday', 90, [{ kind: 'nthWeekday', month: 11, weekday: 0, ordinal: 1 }], ['All Saints’ Day'])
  ];
  for (let ordinal = 2; ordinal <= 8; ordinal += 1) {
    const names = ['', '', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
    events.push(event(`epiphany-${ordinal}`, `The ${names[ordinal]} Sunday after the Epiphany`, 60, [{
      kind: 'relativeDays',
      eventId: 'baptism-of-our-lord',
      days: (ordinal - 1) * 7,
      beforeEventId: 'transfiguration'
    }]));
  }
  PROPER_RANGES.forEach(([startMonth, startDay, endMonth, endDay], index) => {
    const proper = event(`proper-${index + 3}`, `Proper ${index + 3}`, 40, [{
      kind: 'weekdayInDateRange',
      startMonth,
      startDay,
      endMonth,
      endDay,
      weekday: 0,
      afterEventId: 'holy-trinity'
    }]);
    proper.nameMode = 'sundayAfterPentecost';
    events.push(proper);
  });
  events.push(event('last-sunday-church-year', 'The Last Sunday of the Church Year', 70, [{
    kind: 'weekdayInDateRange',
    startMonth: 11,
    startDay: 20,
    endMonth: 11,
    endDay: 26,
    weekday: 0
  }]));
  return events;
};

export function upgradeWelsCalendarPresets(events: ChurchCalendarEvent[], ensureNewEvents = false): ChurchCalendarEvent[] {
  const currentPresets = new Map(welsCalendarPreset().map(item => [item.id, item]));
  const legacyChangedPresets = new Map<string, ChurchCalendarEvent>([
    ['christmas', event('christmas', 'Christmas Day', 100, [{ kind: 'annualDate', month: 12, day: 25 }], ['Christmas'])],
    ['christmas-eve', event('christmas-eve', 'Christmas Eve', 100, [{ kind: 'annualDate', month: 12, day: 24 }])],
    ['name-of-jesus', event('name-of-jesus', 'The Name of Jesus', 90, [{ kind: 'annualDate', month: 1, day: 1 }])],
    ['baptism-of-our-lord', event('baptism-of-our-lord', 'The Baptism of Our Lord', 80, [{ kind: 'weekdayRelative', eventId: 'epiphany', weekday: 0, ordinal: 1, direction: 'after' }])],
    ['easter', event('easter', 'The Resurrection of Our Lord', 110, [{ kind: 'easter' }], ['Easter Sunday', 'Easter'])],
    ['transfiguration', relative('transfiguration', 'The Transfiguration of Our Lord', -49, 80)],
    ['palm-sunday', relative('palm-sunday', 'Sunday of the Passion: Palm Sunday', -7, 100)],
    ['maundy-thursday', relative('maundy-thursday', 'Maundy Thursday', -3, 100)],
    ['holy-trinity', relative('holy-trinity', 'The Holy Trinity', 56, 100)],
    ['reformation', event('reformation', 'Reformation', 90, [{ kind: 'annualDate', month: 10, day: 31 }])],
    ['all-saints', event('all-saints', 'All Saints’ Day', 90, [{ kind: 'annualDate', month: 11, day: 1 }])]
  ]);
  let recognizedVersionOne = false;
  let changed = false;
  const upgraded = events.flatMap(item => {
    const properIndex = LEGACY_PROPER_STARTS.findIndex((_range, index) => item.id === `proper-${index + 3}`);
    if (properIndex >= 0) {
      const [month, day] = LEGACY_PROPER_STARTS[properIndex];
      const legacy = event(item.id, item.name, 40, [{ kind: 'weekdayOnOrAfter', month, day, weekday: 0 }], [`Pentecost ${properIndex + 2}`]);
      legacy.name = `Proper ${properIndex + 3}`;
      if (equivalent({ ...item, name: legacy.name }, legacy)) {
        recognizedVersionOne = true;
        changed = true;
        const replacement = currentPresets.get(item.id);
        if (!replacement) return [];
        const next = structuredClone(replacement);
        if (item.name !== legacy.name) {
          next.name = item.name;
          delete next.nameMode;
        }
        return [next];
      }
    }
    const legacyFestival = legacyChangedPresets.get(item.id);
    if (legacyFestival && equivalent({ ...item, name: legacyFestival.name }, legacyFestival)) {
      recognizedVersionOne = true;
      changed = true;
      const next = structuredClone(currentPresets.get(item.id)!);
      if (item.name !== legacyFestival.name) next.name = item.name;
      return [next];
    }
    return [item];
  });
  const versionTwoIds = ['second-sunday-after-christmas', ...Array.from({ length: 7 }, (_item, index) => `epiphany-${index + 2}`), 'last-sunday-church-year'];
  if (ensureNewEvents || recognizedVersionOne) {
    for (const id of versionTwoIds) if (!upgraded.some(item => item.id === id)) {
      changed = true;
      upgraded.push(structuredClone(currentPresets.get(id)!));
    }
  }
  return changed ? upgraded : events;
}

export function migrateChurchWeekNames(names: Array<{ sourceName: string; displayName: string }>, preset = welsCalendarPreset()) {
  const events = preset.map(item => structuredClone(item));
  for (const name of names) {
    const normalized = name.sourceName.trim().toLocaleLowerCase();
    const match = events.find(item => item.name.toLocaleLowerCase() === normalized || item.aliases?.some(alias => alias.toLocaleLowerCase() === normalized));
    if (match) {
      match.name = name.displayName.trim();
      delete match.nameMode;
    }
    else {
      const baseId = `legacy-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'event'}`;
      let id = baseId;
      for (let suffix = 2; events.some(item => item.id === id); suffix += 1) id = `${baseId}-${suffix}`;
      events.push({ id, name: name.displayName.trim(), aliases: [name.sourceName.trim()], enabled: false, priority: 0, rules: [], needsRule: true });
    }
  }
  return events;
}
