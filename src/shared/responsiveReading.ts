import type { ResponsiveReadingEntry, ResponsiveReadingRole } from './types.js';

export function responsiveEntryRole(entry: Pick<ResponsiveReadingEntry, 'reader' | 'role'>): ResponsiveReadingRole {
  if (entry.role) return entry.role;
  return /^C(?:\b|:)/i.test(entry.reader.trim()) ? 'follower' : 'leader';
}

export function defaultReaderForRole(role: ResponsiveReadingRole) {
  return role === 'follower' ? 'C' : 'M';
}
