import { describe, expect, it } from 'vitest';
import { churchWeekDisplayName, validChurchWeekNames } from '../src/shared/churchWeeks';

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
});
