import { describe, expect, it } from 'vitest';
import { randomId } from '../src/shared/id';

describe('randomId', () => {
  it('uses randomUUID when the secure-context API is available', () => {
    expect(randomId({ randomUUID: () => 'secure-id' })).toBe('secure-id');
  });

  it('creates an RFC 4122 version 4 ID when randomUUID is unavailable', () => {
    const id = randomId({
      getRandomValues: array => {
        if (array instanceof Uint8Array) array.forEach((_, index) => { array[index] = index; });
        return array;
      }
    });
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
