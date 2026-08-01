import { describe, expect, it } from 'vitest';
import { sundayOnOrAfter } from '../src/shared/dates';

describe('weekly dates', () => {
  it('snaps a date forward to Sunday and leaves Sunday unchanged', () => {
    expect(sundayOnOrAfter('2026-08-01')).toBe('2026-08-02');
    expect(sundayOnOrAfter('2026-08-02')).toBe('2026-08-02');
    expect(sundayOnOrAfter('2026-12-31')).toBe('2027-01-03');
  });
});
