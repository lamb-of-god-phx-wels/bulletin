import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
import { prepackagedComponentDefinitions } from '../componentDefinitions.js';
import type { ElementPaletteItem } from './ElementPalette.js';

export type ElementPalettePayload =
  | { kind: 'component'; definition: DeclarativeComponentDefinition }
  | { kind: 'image' }
  | { kind: 'page' }
  | { kind: 'fullPageAsset' }
  | { kind: 'shape'; shape: 'rectangle' | 'line' };

const latestDefinitions = (definitions: DeclarativeComponentDefinition[]) =>
  [...new Map(definitions.slice().sort((left, right) => left.version - right.version).map(definition => [definition.type, definition])).values()];

export function flowElementPaletteItems(workspaceDefinitions: DeclarativeComponentDefinition[], includePages = true): ElementPaletteItem[] {
  const components = [...prepackagedComponentDefinitions, ...latestDefinitions(workspaceDefinitions)].map(definition => ({
    id: `component:${definition.type}@${definition.version}`,
    label: definition.name,
    description: definition.description,
    icon: definition.editor?.icon ?? '◇',
    category: 'content' as const,
    payload: { kind: 'component' as const, definition }
  }));
  return [
    ...components,
    { id: 'native:image', label: 'Image', description: 'An image that flows with document content.', icon: '▧', category: 'media', payload: { kind: 'image' } },
    ...(includePages ? [
      { id: 'native:page', label: 'Page', description: 'Insert or create a reusable page.', icon: '▣', category: 'pages' as const, payload: { kind: 'page' as const } },
      { id: 'native:full-page-asset', label: 'Full-page image / PDF', description: 'Insert a one-off full-page asset.', icon: '▤', category: 'pages' as const, payload: { kind: 'fullPageAsset' as const } }
    ] : [])
  ] as ElementPaletteItem[];
}

export function canvasElementPaletteItems(workspaceDefinitions: DeclarativeComponentDefinition[]): ElementPaletteItem[] {
  return [
    ...flowElementPaletteItems(workspaceDefinitions, false),
    { id: 'shape:rectangle', label: 'Rectangle', icon: '□', category: 'shapes', payload: { kind: 'shape', shape: 'rectangle' } },
    { id: 'shape:line', label: 'Line', icon: '╱', category: 'shapes', payload: { kind: 'shape', shape: 'line' } }
  ] as ElementPaletteItem[];
}
