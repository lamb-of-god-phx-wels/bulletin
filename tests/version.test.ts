import { describe, expect, it } from 'vitest';
import { compareVersions, meetsMinimumVersion, parseVersion } from '../src/shared/version';

describe('application versions', () => {
  it('parses release and prerelease semantic versions', () => {
    expect(parseVersion('v1.2.3')).toEqual({ numbers: [1, 2, 3], prerelease: [] });
    expect(parseVersion('1.2.3-beta.2')?.prerelease).toEqual(['beta', 2]);
    expect(parseVersion('development')).toBeUndefined();
  });

  it('orders releases and prereleases deterministically', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.1')).toBe(1);
  });

  it('enforces a configured minimum version', () => {
    expect(meetsMinimumVersion('0.2.0', '0.2.0')).toBe(true);
    expect(meetsMinimumVersion('0.1.9', '0.2.0')).toBe(false);
    expect(meetsMinimumVersion('development', '0.2.0')).toBe(false);
  });
});
