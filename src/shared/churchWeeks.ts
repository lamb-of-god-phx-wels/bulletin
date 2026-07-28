import type { ChurchWeekName } from './types.js';

const normalized = (value: string) => value.trim().toLocaleLowerCase();

export function churchWeekDisplayName(value: string, names: ChurchWeekName[] = []): string {
  const match = churchWeekNameOverride(value, names) ?? names.find(name => normalized(name.displayName) === normalized(value));
  return match?.displayName.trim() || value;
}

export function churchWeekNameOverride(sourceName: string, names: ChurchWeekName[] = []): ChurchWeekName | undefined {
  return names.find(name => normalized(name.sourceName) === normalized(sourceName));
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
