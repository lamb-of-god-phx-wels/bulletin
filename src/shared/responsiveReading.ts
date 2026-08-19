import type { BulletinBlock, Inline, Paragraph, ResponsiveReadingEntry, ResponsiveReadingRole, ResponsiveReadingSettings, TemplateV1, BulletinDocumentV1 } from './types.js';

export const defaultResponsiveReadingSettings: ResponsiveReadingSettings = {
  labels: { leader: 'M', follower: 'C', all: 'All' },
  italicizeSilentPrayer: true,
};

export function shouldItalicizeSilentPrayer(settings: ResponsiveReadingSettings) {
  return settings.italicizeSilentPrayer !== false;
}

export function isSilentPrayerEntry(entry: Pick<ResponsiveReadingEntry, 'element'>) {
  return entry.element === 'silentPrayer';
}

export function responsiveEntryRole(entry: Pick<ResponsiveReadingEntry, 'reader' | 'role'>): ResponsiveReadingRole {
  if (entry.role) return entry.role;
  if (/^All(?:\b|:)/i.test(entry.reader.trim())) return 'all';
  return /^C(?:\b|:)/i.test(entry.reader.trim()) ? 'follower' : 'leader';
}

export function defaultReaderForRole(role: ResponsiveReadingRole) {
  return defaultResponsiveReadingSettings.labels[role];
}

export function effectiveResponsiveReadingSettings(template: Pick<TemplateV1, 'responsiveReading'>, document?: Pick<BulletinDocumentV1, 'responsiveReading'>): ResponsiveReadingSettings {
  return document?.responsiveReading ?? template.responsiveReading ?? defaultResponsiveReadingSettings;
}

export function responsiveReaderIsConfigured(entry: ResponsiveReadingEntry, settings: ResponsiveReadingSettings) {
  if (isSilentPrayerEntry(entry)) return false;
  if (entry.readerMode) return entry.readerMode === 'configured';
  const role = responsiveEntryRole(entry);
  const reader = entry.reader.trim().toLocaleLowerCase();
  return reader === settings.labels[role].trim().toLocaleLowerCase()
    || reader === defaultReaderForRole(role).toLocaleLowerCase();
}

export function responsiveEntryReader(entry: ResponsiveReadingEntry, settings: ResponsiveReadingSettings) {
  if (isSilentPrayerEntry(entry)) return '';
  return responsiveReaderIsConfigured(entry, settings)
    ? settings.labels[responsiveEntryRole(entry)]
    : entry.reader;
}

export function responsiveReadingSettingsIssues(settings: ResponsiveReadingSettings) {
  const labels = Object.values(settings.labels).map(label => label.trim());
  const issues: string[] = [];
  if (labels.some(label => !label)) issues.push('Reader labels cannot be blank.');
  if (labels.some(label => /[:\r\n]/.test(label))) issues.push('Reader labels cannot contain colons or line breaks.');
  if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) issues.push('Reader labels must be unique.');
  return issues;
}

function lineText(line: Inline[]) {
  return line.map(run => run.type === 'text' ? run.text : run.type === 'symbol' ? '✠' : '').join('');
}

function splitLines(children: Inline[]) {
  const lines: Inline[][] = [[]];
  for (const run of children) {
    if (run.type === 'lineBreak') lines.push([]);
    else lines.at(-1)!.push(structuredClone(run));
  }
  return lines;
}

function dropCharacters(line: Inline[], count: number) {
  const result: Inline[] = [];
  let remaining = count;
  for (const run of line) {
    const length = run.type === 'text' ? run.text.length : 1;
    if (remaining >= length) {
      remaining -= length;
      continue;
    }
    if (run.type === 'text' && remaining) result.push({ ...run, text: run.text.slice(remaining) });
    else result.push(run);
    remaining = 0;
  }
  return result;
}

type ReaderAlias = { label: string; role: ResponsiveReadingRole; readerMode: 'configured' | 'custom' };

function readerAliases(settings: ResponsiveReadingSettings, existing: ResponsiveReadingEntry[]) {
  const configured = (Object.keys(settings.labels) as ResponsiveReadingRole[]).map(role => ({
    label: settings.labels[role], role, readerMode: 'configured' as const,
  }));
  const custom = existing.filter(entry => !responsiveReaderIsConfigured(entry, settings)).map(entry => ({
    label: entry.reader, role: responsiveEntryRole(entry), readerMode: 'custom' as const,
  }));
  return [...configured, ...custom]
    .filter((alias, index, aliases) => alias.label.trim() && aliases.findIndex(candidate => candidate.label.trim().toLocaleLowerCase() === alias.label.trim().toLocaleLowerCase()) === index)
    .sort((left, right) => right.label.length - left.label.length);
}

function prefixedLine(line: Inline[], aliases: ReaderAlias[]) {
  const text = lineText(line);
  const alias = aliases.find(candidate => text.slice(0, candidate.label.length + 1).toLocaleLowerCase() === `${candidate.label}:`.toLocaleLowerCase());
  if (!alias) return;
  const whitespace = text.slice(alias.label.length + 1).match(/^[ \t]*/)?.[0].length ?? 0;
  return { alias, content: dropCharacters(line, alias.label.length + 1 + whitespace) };
}

function silentPrayerLine(line: Inline[]) {
  return lineText(line) === 'Silent Prayer';
}

export type ResponsiveReadingParseResult =
  | { entries: ResponsiveReadingEntry[]; error?: undefined }
  | { entries?: undefined; error: string };

export function parseResponsiveReadingContent(content: Paragraph[], settings: ResponsiveReadingSettings, existing: ResponsiveReadingEntry[] = []): ResponsiveReadingParseResult {
  const aliases = readerAliases(settings, existing);
  const entries: ResponsiveReadingEntry[] = [];
  let current: ResponsiveReadingEntry | undefined;
  let pendingBreaks = 0;
  content.forEach((paragraph, paragraphIndex) => {
    const lines = splitLines(paragraph.children);
    lines.forEach((line, lineIndex) => {
      if (silentPrayerLine(line)) {
        entries.push({
          reader: '',
          element: 'silentPrayer',
          content: [{ type: 'paragraph', ...(paragraph.align ? { align: paragraph.align } : {}), children: structuredClone(line) }],
        });
        current = undefined;
        pendingBreaks = 0;
        return;
      }
      const prefix = prefixedLine(line, aliases);
      if (prefix) {
        current = {
          reader: prefix.alias.label,
          role: prefix.alias.role,
          readerMode: prefix.alias.readerMode,
          content: [{ type: 'paragraph', ...(paragraph.align ? { align: paragraph.align } : {}), children: prefix.content.length ? prefix.content : [{ type: 'text', text: '' }] }],
        };
        entries.push(current);
        pendingBreaks = 0;
        return;
      }
      const nonblank = lineText(line).trim().length > 0;
      if (!current) {
        if (nonblank) throw new Error('Start the reading with a configured reader label followed by a colon.');
        return;
      }
      pendingBreaks += lineIndex > 0 ? 1 : paragraphIndex > 0 ? paragraph.breakBefore === 'line' ? 1 : 2 : 0;
      if (!nonblank && !line.length) return;
      if (pendingBreaks >= 2) {
        current.content.push({ type: 'paragraph', ...(paragraph.align ? { align: paragraph.align } : {}), children: line.length ? line : [{ type: 'text', text: '' }] });
      } else if (pendingBreaks === 1) {
        current.content.push({ type: 'paragraph', breakBefore: 'line', ...(paragraph.align ? { align: paragraph.align } : {}), children: line.length ? line : [{ type: 'text', text: '' }] });
      } else if (line.length) {
        current.content.at(-1)!.children.push(...line);
      }
      pendingBreaks = 0;
    });
  });
  if (current && pendingBreaks === 1) current.content.push({ type: 'paragraph', breakBefore: 'line', children: [{ type: 'text', text: '' }] });
  if (current && pendingBreaks >= 2) current.content.push({ type: 'paragraph', children: [{ type: 'text', text: '' }] });
  return { entries };
}

export function safeParseResponsiveReadingContent(content: Paragraph[], settings: ResponsiveReadingSettings, existing: ResponsiveReadingEntry[] = []): ResponsiveReadingParseResult {
  try {
    return parseResponsiveReadingContent(content, settings, existing);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function responsiveReadingEditorContent(entries: ResponsiveReadingEntry[], settings: ResponsiveReadingSettings): Paragraph[] {
  return entries.flatMap(entry => {
    const paragraphs = entry.content.length ? entry.content : [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: '' }] }];
    const lines = paragraphs.flatMap(paragraph => splitLines(paragraph.children).map((children, index) => ({
      ...structuredClone(paragraph),
      ...(index ? { breakBefore: 'line' as const } : {}),
      children: children.length ? children : [{ type: 'text' as const, text: '' }],
    })));
    if (isSilentPrayerEntry(entry)) return lines;
    return lines.map((paragraph, index) => ({
      ...structuredClone(paragraph),
      children: index === 0
        ? [{ type: 'text' as const, text: `${responsiveEntryReader(entry, settings)}: ` }, ...structuredClone(paragraph.children)]
        : structuredClone(paragraph.children),
    }));
  });
}

export function updateResponsiveReaderLabels(blocks: BulletinBlock[], previous: ResponsiveReadingSettings, next: ResponsiveReadingSettings): BulletinBlock[] {
  const updateBlock = (block: BulletinBlock): BulletinBlock => {
    if (block.type === 'responsiveReading') return {
      ...block,
      entries: block.entries.map(entry => {
        if (isSilentPrayerEntry(entry)) return entry;
        const role = responsiveEntryRole(entry);
        return responsiveReaderIsConfigured(entry, previous)
          ? { ...entry, role, readerMode: 'configured', reader: next.labels[role] }
          : { ...entry, role, readerMode: 'custom' };
      }),
    };
    if (block.type === 'group') return { ...block, children: block.children.map(updateBlock) };
    if (block.type === 'elementChooser') return { ...block, choices: block.choices.map(choice => choice.block ? ({ ...choice, block: updateBlock(choice.block) }) : choice) };
    if (block.type === 'paragraph') return { ...block, children: block.children.map(child => updateBlock(child) as typeof child) };
    if (block.type === 'templatePage') return { ...block, blocks: block.blocks.map(updateBlock) };
    if (block.type === 'templateInstance') return { ...block, blocks: block.blocks.map(updateBlock) };
    if (block.type === 'canvas') return {
      ...block,
      scene: {
        ...block.scene,
        elements: block.scene.elements.map(element => element.type === 'block' ? { ...element, block: updateBlock(element.block) } : element),
      },
    };
    return block;
  };
  return blocks.map(updateBlock);
}
