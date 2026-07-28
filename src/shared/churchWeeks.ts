import type { ChurchWeekCalendarEntry, ChurchWeekName } from './types.js';

const normalized = (value: string) => value.trim().toLocaleLowerCase();

export function churchWeekDisplayName(value: string, names: ChurchWeekName[] = []): string {
  const match = names.find(name => normalized(name.sourceName) === normalized(value) || normalized(name.displayName) === normalized(value));
  return match?.displayName.trim() || value;
}

export function validChurchWeekNames(names: ChurchWeekName[]): ChurchWeekName[] {
  const seen = new Set<string>();
  return names
    .map(name => ({ sourceName: name.sourceName.trim(), displayName: name.displayName.trim() }))
    .filter(name => {
      const key = normalized(name.sourceName);
      if (!key || !name.displayName || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const months: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

function isoDate(value: string): string | undefined {
  const trimmed = value.trim().replace(/^(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?),?\s+/i, '');
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    const short = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (short) match = [short[0], short[3], short[1], short[2]];
  }
  if (!match) {
    const long = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    const month = long ? months[long[1].toLocaleLowerCase()] : undefined;
    if (long && month) match = [long[0], long[3], String(month), long[2]];
  }
  if (!match) return undefined;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function plainText(value: string): string {
  return value
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '');
}

export function importChurchWeekCalendar(value: string): ChurchWeekCalendarEntry[] {
  const lines = plainText(value).split('\n').map(line => line.replace(/[^\S\t]+/g, ' ').trim()).filter(Boolean);
  const imported = new Map<string, ChurchWeekCalendarEntry>();
  let pendingDate: string | undefined;
  let previousLine: string | undefined;
  for (const line of lines) {
    const longPair = line.match(/^((?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,\s+)?[A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*(?:,|[|;]|\s+[–—-]\s+)\s*(.+)$/i);
    if (longPair) {
      const date = isoDate(longPair[1]);
      if (date) { imported.set(date, { date, sourceName: longPair[2].trim() }); pendingDate = undefined; previousLine = line; continue; }
    }
    const columns = line.split(/\s*(?:\t|[|;]|\s+[–—]\s+)\s*/).filter(Boolean);
    if (columns.length >= 2) {
      const firstDate = isoDate(columns[0]);
      const lastDate = isoDate(columns.at(-1)!);
      if (firstDate) { imported.set(firstDate, { date: firstDate, sourceName: columns.slice(1).join(' ').trim() }); pendingDate = undefined; previousLine = line; continue; }
      if (lastDate) { imported.set(lastDate, { date: lastDate, sourceName: columns.slice(0, -1).join(' ').trim() }); pendingDate = undefined; previousLine = line; continue; }
    }
    const csv = line.match(/^(.+?),\s*(.+)$/);
    if (csv) {
      const leftDate = isoDate(csv[1]); const rightDate = isoDate(csv[2]);
      if (leftDate) { imported.set(leftDate, { date: leftDate, sourceName: csv[2].trim() }); pendingDate = undefined; previousLine = line; continue; }
      if (rightDate) { imported.set(rightDate, { date: rightDate, sourceName: csv[1].trim() }); pendingDate = undefined; previousLine = line; continue; }
    }
    const date = isoDate(line);
    if (date) {
      pendingDate = date;
      if (previousLine && !isoDate(previousLine)) imported.set(date, { date, sourceName: previousLine });
      previousLine = line;
      continue;
    }
    if (pendingDate) {
      imported.set(pendingDate, { date: pendingDate, sourceName: line });
      pendingDate = undefined;
    }
    previousLine = line;
  }
  return [...imported.values()].filter(entry => entry.sourceName).sort((left, right) => left.date.localeCompare(right.date));
}

export function validChurchWeekCalendar(entries: ChurchWeekCalendarEntry[]): ChurchWeekCalendarEntry[] {
  const byDate = new Map<string, ChurchWeekCalendarEntry>();
  for (const entry of entries) {
    const date = isoDate(entry.date); const sourceName = entry.sourceName.trim();
    if (date && sourceName) byDate.set(date, { date, sourceName });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function churchWeekForDate(date: string, entries: ChurchWeekCalendarEntry[] = [], names: ChurchWeekName[] = []): string | undefined {
  const entry = entries.find(candidate => candidate.date === date);
  return entry ? churchWeekDisplayName(entry.sourceName, names) : undefined;
}
