interface CalendarEvent {
  type?: unknown;
  attributes?: {
    date?: unknown;
    name?: unknown;
    'full-name'?: unknown;
    'holiday-type'?: unknown;
  };
}

export function serviceBuilderChurchWeek(payload: unknown, date: string): { sourceName: string } {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('Service Builder returned an invalid calendar response.');
  }
  const events = (payload as { data: CalendarEvent[] }).data.filter(event =>
    typeof event.type === 'string' &&
    event.type.toLocaleLowerCase().includes('holiday') &&
    typeof event.attributes?.date === 'string' &&
    event.attributes.date.slice(0, 10) === date
  );
  const event = events.find(candidate => candidate.attributes?.['holiday-type'] !== 'occasion') ?? events[0];
  const sourceName = typeof event?.attributes?.name === 'string' ? event.attributes.name.trim() : '';
  if (!sourceName) throw new Error(`Service Builder has no designated church week for ${date}.`);
  return { sourceName };
}
