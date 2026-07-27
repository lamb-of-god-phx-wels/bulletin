import { loadComponentCatalog, parseComponentDefinition } from './component-engine/catalog.js';
import type {
  ComponentDiagnostic,
  ComponentStyle,
  DeclarativeComponentDefinition,
  JsonValue,
  StructuredText
} from './component-engine/types.js';
import type { BulletinBlock, CustomBlockStyle, Paragraph } from './shared/types.js';
import { defaultCanvasScene } from './shared/canvas.js';

const packagedFiles = import.meta.glob<string>('../component-definitions/prepackaged/*.json', {
  eager: true,
  query: '?raw',
  import: 'default'
});

const packagedCatalog = loadComponentCatalog(packagedFiles);

const paletteOrder = [
  'bulletin:coverPage',
  'bulletin:scriptureReading',
  'bulletin:song',
  'bulletin:heading',
  'bulletin:paragraph',
  'bulletin:sectionHeading',
  'bulletin:text',
  'bulletin:responsiveReading',
  'bulletin:libraryText',
  'bulletin:announcements',
  'bulletin:churchInformation',
  'bulletin:spacer',
  'bulletin:copyright'
];

export const prepackagedComponentDefinitions = packagedCatalog.registry.list()
  .filter(definition => definition.editor?.palette !== false)
  .sort((left, right) => {
    const leftIndex = paletteOrder.indexOf(left.type);
    const rightIndex = paletteOrder.indexOf(right.type);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
      left.name.localeCompare(right.name);
  });

export const prepackagedComponentDiagnostics = packagedCatalog.diagnostics;

export function parseImportedComponent(raw: string, workspaceDefinitions: DeclarativeComponentDefinition[] = []): {
  definition?: DeclarativeComponentDefinition;
  diagnostics: ComponentDiagnostic[];
} {
  const parsed = parseComponentDefinition(raw);
  if (!parsed.definition) return parsed;
  const importedSource = '99-imported-component.json';
  const files = {
    ...Object.fromEntries(Object.entries(packagedFiles).map(([name, value]) => [`00-packaged/${name}`, value])),
    ...Object.fromEntries(workspaceDefinitions.map((definition, index) => [`50-workspace/${index}-${definition.type}@${definition.version}.json`, JSON.stringify(definition)])),
    [importedSource]: raw
  };
  const catalog = loadComponentCatalog(files);
  const diagnostics = catalog.diagnostics.filter(item =>
    item.sourceId === importedSource ||
    (item.componentType === parsed.definition!.type && item.code === 'COMPONENT_DEPENDENCY_MISSING')
  );
  return diagnostics.some(item => item.severity === 'error') ? { diagnostics } : { definition: parsed.definition, diagnostics };
}

function idFor(definition: DeclarativeComponentDefinition) {
  return `${definition.type.split(':').at(-1) ?? 'component'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function structuredText(value: JsonValue | undefined): StructuredText {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.blocks)) {
    return value as unknown as StructuredText;
  }
  return { blocks: [] };
}

function paragraphs(value: JsonValue | undefined): Paragraph[] {
  return structuredText(value).blocks.reduce<Paragraph[]>((result, block) => {
    if (block.type === 'lineBreak') {
      const paragraph = result.at(-1);
      if (paragraph) paragraph.children.push({ type: 'lineBreak' });
      return result;
    }
    result.push({
      type: 'paragraph',
      children: (block.inlines ?? []).map(inline => ({
        type: 'text' as const,
        text: inline.value,
        ...(inline.marks?.length ? { marks: inline.marks } : inline.emphasis ? { marks: [inline.emphasis] } : {})
      }))
    });
    return result;
  }, []);
}

function presentation(style: ComponentStyle | undefined): Partial<CustomBlockStyle> | undefined {
  if (!style) return undefined;
  return {
    ...(style.widthPercent !== undefined ? { widthPercent: style.widthPercent } : {}),
    ...(style.placement ? { placement: style.placement } : {}),
    ...(style.textAlign ? { textAlign: style.textAlign } : {}),
    ...(style.paddingIn ? {
      paddingIn: {
        top: style.paddingIn.top ?? 0,
        right: style.paddingIn.right ?? 0,
        bottom: style.paddingIn.bottom ?? 0,
        left: style.paddingIn.left ?? 0
      }
    } : {}),
    ...(style.marginIn ? { marginIn: { top: style.marginIn.top ?? 0, bottom: style.marginIn.bottom ?? 0 } } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.fontSizePt !== undefined ? { fontSizePt: style.fontSizePt } : {}),
    ...(style.lineHeight !== undefined ? { lineHeight: style.lineHeight } : {}),
    ...(style.fontWeight === 'normal' || style.fontWeight === 'bold' ? { fontWeight: style.fontWeight } : {}),
    ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
    ...(style.textTransform ? { textTransform: style.textTransform } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.borderWidthPt !== undefined ? { borderWidthPt: style.borderWidthPt } : {}),
    ...(style.borderColor ? { borderColor: style.borderColor } : {}),
    ...(style.borderRadiusPt !== undefined ? { borderRadiusPt: style.borderRadiusPt } : {})
  };
}

function richText(id: string, content: Paragraph[], role?: 'header' | 'body', style?: ComponentStyle): BulletinBlock {
  return { id, type: 'richText', content, role, presentation: presentation(style) };
}

function paragraphBlock(id: string, heading: string | undefined, body: JsonValue | undefined, definition: DeclarativeComponentDefinition): BulletinBlock {
  const children: BulletinBlock[] = [];
  if (heading) children.push(richText(`${id}-heading`, [{ type: 'paragraph', children: [{ type: 'text', text: heading }] }], 'header', definition.defaultStyles?.parts?.heading));
  children.push(richText(`${id}-body`, paragraphs(body), 'body', definition.defaultStyles?.parts?.body));
  return {
    id,
    type: 'paragraph',
    weeklyEditable: true,
    children: children as Extract<BulletinBlock, { type: 'paragraph' }>['children'],
    presentation: presentation(definition.defaultStyles?.root),
    layout: { keepTogether: definition.defaultStyles?.root?.keepTogether }
  };
}

/**
 * Creates the current persisted bulletin representation from a component
 * definition. The definition is the sole source of defaults and formatting;
 * there is no second prototype-descriptor catalog.
 */
export function instantiateComponentDefinition(definition: DeclarativeComponentDefinition): BulletinBlock {
  const id = idFor(definition);
  const sample = structuredClone(definition.sampleInputs ?? {}) as Record<string, JsonValue>;
  const base = {
    id,
    weeklyEditable: true,
    presentation: presentation(definition.defaultStyles?.root),
    layout: {
      keepTogether: definition.defaultStyles?.root?.keepTogether,
      pageBreakBefore: definition.defaultStyles?.root?.pageBreakBefore
    }
  };

  switch (definition.type) {
    case 'bulletin:coverPage':
      return {
        ...base,
        type: 'canvasCover',
        scene: sample.scene && typeof sample.scene === 'object' && !Array.isArray(sample.scene)
          ? structuredClone(sample.scene) as unknown as import('./shared/types.js').CanvasScene
          : defaultCanvasScene()
      };
    case 'bulletin:text':
      return { ...base, type: 'richText', content: paragraphs(sample.content) };
    case 'bulletin:paragraph':
      return paragraphBlock(id, typeof sample.heading === 'string' ? sample.heading : undefined, sample.body, definition);
    case 'bulletin:heading':
      return { ...base, type: 'heading', text: typeof sample.text === 'string' ? sample.text : definition.name };
    case 'bulletin:sectionHeading':
      return { ...base, type: 'sectionHeading', text: typeof sample.text === 'string' ? sample.text : definition.name };
    case 'bulletin:scriptureReading':
      return {
        ...base,
        type: 'scriptureReading',
        label: typeof sample.heading === 'string' ? sample.heading : undefined,
        reference: typeof sample.reference === 'string' ? sample.reference : '',
        caption: typeof sample.caption === 'string' ? sample.caption : undefined,
        headingReferenceLayout: sample.headingReferenceLayout === 'stacked' ? 'stacked' : 'inline',
        headingReferenceGapIn: typeof sample.headingReferenceGapIn === 'number' ? sample.headingReferenceGapIn : 0.12,
        translation: 'NIV',
        resolved: {
          content: paragraphs(sample.body),
          source: 'manual',
          retrievedAt: new Date().toISOString(),
          attribution: 'NIV — sample text'
        },
        elements: Object.fromEntries(['heading', 'reference', 'caption', 'body'].map(part => [part, {
          presentation: presentation(definition.defaultStyles?.parts?.[part])
        }]))
      };
    case 'bulletin:responsiveReading':
      return {
        ...base,
        type: 'responsiveReading',
        entries: Array.isArray(sample.items) ? sample.items.map(item => {
          const entry = item as Record<string, JsonValue>;
          return {
            reader: typeof entry.reader === 'string' ? entry.reader : '',
            role: entry.role === 'follower' ? 'follower' as const : 'leader' as const,
            content: paragraphs(entry.body)
          };
        }) : []
      };
    case 'bulletin:song': {
      const verses = Array.isArray(sample.verses) ? sample.verses : [];
      return {
        ...base,
        type: 'song',
        songType: 'hymn',
        libraryItemId: '',
        selection: { mode: 'all' },
        renderMode: sample.contentMode === 'asset' ? 'asset' : 'lyrics',
        label: typeof sample.label === 'string' ? sample.label : 'Hymn',
        title: typeof sample.title === 'string' ? sample.title : definition.name,
        contentOverride: verses.flatMap(verse => paragraphs((verse as Record<string, JsonValue>).body))
      };
    }
    case 'bulletin:announcements':
      return {
        ...base,
        type: 'announcements',
        items: Array.isArray(sample.items) ? sample.items.map((item, index) => {
          const announcement = item as Record<string, JsonValue>;
          return {
            id: typeof announcement.id === 'string' ? announcement.id : `${id}-item-${index}`,
            title: typeof announcement.heading === 'string' ? announcement.heading : '',
            content: paragraphs(announcement.body)
          };
        }) : []
      };
    case 'bulletin:churchInformation': {
      const sections = Array.isArray(sample.sections) ? sample.sections : [];
      return {
        ...base,
        type: 'churchInfo',
        children: sections.map((section, index) => {
          const value = section as Record<string, JsonValue>;
          return paragraphBlock(
            `${id}-${typeof value.id === 'string' ? value.id : index}`,
            typeof value.heading === 'string' ? value.heading : undefined,
            value.body,
            definition
          );
        })
      };
    }
    case 'bulletin:libraryText':
      return {
        ...base,
        type: 'libraryText',
        libraryItemId: typeof sample.libraryItemId === 'string' ? sample.libraryItemId : '',
        title: typeof sample.title === 'string' ? sample.title : definition.name,
        contentOverride: paragraphs(sample.content)
      };
    case 'bulletin:copyright':
      return { ...base, type: 'copyright', extra: paragraphs(sample.notices) };
    case 'bulletin:spacer': {
      const points = typeof sample.size === 'number' ? sample.size : 12;
      return { ...base, type: 'spacer', size: points <= 8 ? 'small' : points >= 20 ? 'large' : 'medium' };
    }
    default: {
      const bindings = definition.editor?.fields.map(field => ({
        key: field.input,
        label: field.label,
        source: 'weekly' as const,
        defaultValue: typeof sample[field.input] === 'string' ? sample[field.input] as string : JSON.stringify(sample[field.input] ?? '', null, 2),
        multiline: field.control === 'textarea' || field.control === 'structuredText' || field.control === 'collection'
      })) ?? [];
      return {
        ...base,
        type: 'custom',
        name: definition.name,
        label: definition.name,
        layoutText: bindings.map(binding => `{{${binding.key}}}`).join('\n\n'),
        bindings,
        values: Object.fromEntries(bindings.map(binding => [binding.key, binding.defaultValue ?? '']))
      };
    }
  }
}
