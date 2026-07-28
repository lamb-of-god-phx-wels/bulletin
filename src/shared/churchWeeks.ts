import type { ChurchWeekName } from './types.js';

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
