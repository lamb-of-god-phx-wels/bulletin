import { describe, expect, it } from 'vitest';
import { serviceBuilderChurchWeek } from '../src/shared/serviceBuilder';

describe('Service Builder church-week lookup', () => {
  it('selects the designated non-occasion holiday and keeps its terse source name', () => {
    const payload = { data: [
      { type: 'holidays', attributes: { date: '2026-08-02', name: 'St. Example', 'holiday-type': 'occasion' } },
      { type: 'holidays', attributes: { date: '2026-08-02', name: 'Pentecost 10', 'full-name': 'Tenth Sunday after Pentecost', 'holiday-type': 'sunday' } }
    ] };
    expect(serviceBuilderChurchWeek(payload, '2026-08-02')).toEqual({ sourceName: 'Pentecost 10' });
  });

  it('rejects invalid responses and dates without a designated holiday', () => {
    expect(() => serviceBuilderChurchWeek({}, '2026-08-02')).toThrow('invalid calendar response');
    expect(() => serviceBuilderChurchWeek({ data: [] }, '2026-08-02')).toThrow('no designated church week');
  });
});
