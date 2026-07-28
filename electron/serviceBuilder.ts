import { serviceBuilderChurchWeek } from '../src/shared/serviceBuilder.js';

export async function lookupServiceBuilderChurchWeek(date: string): Promise<{ sourceName: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid service date first.');
  const url = new URL('https://builder.christianworship.com/api/v1/calendar_events');
  url.searchParams.set('startDate', date);
  url.searchParams.set('endDate', date);
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Service Builder lookup failed (${response.status}).`);
  return serviceBuilderChurchWeek(await response.json(), date);
}
