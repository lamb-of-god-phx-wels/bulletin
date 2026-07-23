import { describe, expect, it } from 'vitest';
import { defaultReaderForRole, responsiveEntryRole } from '../src/shared/responsiveReading';

describe('responsive reading roles', () => {
  it('keeps explicit leader and follower roles independent of their display labels', () => {
    expect(responsiveEntryRole({ reader: 'Pastor', role: 'leader' })).toBe('leader');
    expect(responsiveEntryRole({ reader: 'Everyone', role: 'follower' })).toBe('follower');
  });

  it('recognizes existing congregation labels without requiring a data migration', () => {
    expect(responsiveEntryRole({ reader: 'M' })).toBe('leader');
    expect(responsiveEntryRole({ reader: 'C' })).toBe('follower');
    expect(responsiveEntryRole({ reader: 'C (cont.)' })).toBe('follower');
  });

  it('uses the template defaults for newly selected roles', () => {
    expect(defaultReaderForRole('leader')).toBe('M');
    expect(defaultReaderForRole('follower')).toBe('C');
  });
});
