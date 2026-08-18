import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
import { prepackagedComponentDefinitions } from '../componentDefinitions.js';
import type { ElementPaletteItem } from './ElementPalette.js';

export type ElementPalettePayload =
  | { kind: 'component'; definition: DeclarativeComponentDefinition }
  | { kind: 'image' }
  | { kind: 'page' }
  | { kind: 'template' }
  | { kind: 'fullPageAsset' }
  | { kind: 'container'; layoutMode: 'grid' | 'table' }
  | { kind: 'shape'; shape: 'rectangle' | 'line' };

const latestDefinitions = (definitions: DeclarativeComponentDefinition[]) =>
  [...new Map(definitions.slice().sort((left, right) => left.version - right.version).map(definition => [definition.type, definition])).values()];

export function flowElementPaletteItems(workspaceDefinitions: DeclarativeComponentDefinition[], includePages = true, includeContainers = true): ElementPaletteItem[] {
  const components = [...prepackagedComponentDefinitions, ...latestDefinitions(workspaceDefinitions)]
    .filter(definition => definition.type !== 'bulletin:sectionHeading')
    .map(definition => ({
    id: `component:${definition.type}@${definition.version}`,
    label: definition.name,
    description: definition.description,
    icon: definition.editor?.icon ?? '◇',
    category: 'content' as const,
    payload: { kind: 'component' as const, definition }
  }));
  return [
    ...components,
    ...(includeContainers ? [
      { id: 'container:grid', label: 'Grid', description: 'Arrange child elements in equal-width columns.', icon: '▦', category: 'layout' as const, payload: { kind: 'container' as const, layoutMode: 'grid' as const } },
      { id: 'container:table', label: 'Table', description: 'Arrange child elements in bordered rows and columns.', icon: '▥', category: 'layout' as const, payload: { kind: 'container' as const, layoutMode: 'table' as const } }
    ] : []),
    { id: 'native:image', label: 'Image', description: 'An image that flows with document content.', icon: '▧', category: 'media', payload: { kind: 'image' } },
    ...(includePages ? [
      { id: 'native:template', label: 'Sub-template', description: 'Insert a published bulletin template as one reusable element.', icon: '▥', category: 'pages' as const, payload: { kind: 'template' as const } },
      { id: 'native:page', label: 'Page Design', description: 'Insert or create a reusable page design.', icon: '▣', category: 'pages' as const, payload: { kind: 'page' as const } },
      { id: 'native:full-page-asset', label: 'Full-page image / PDF', description: 'Insert a one-off full-page asset.', icon: '▤', category: 'pages' as const, payload: { kind: 'fullPageAsset' as const } }
    ] : [])
  ] as ElementPaletteItem[];
}

export function bulletinEditorElementPaletteItems(workspaceDefinitions: DeclarativeComponentDefinition[], includePages = true, includeContainers = true): ElementPaletteItem[] {
  return flowElementPaletteItems(workspaceDefinitions, includePages, includeContainers).filter(item => {
    const payload = item.payload as ElementPalettePayload;
    return payload.kind !== 'component' || payload.definition.type !== 'bulletin:text';
  });
}

export function canvasElementPaletteItems(workspaceDefinitions: DeclarativeComponentDefinition[]): ElementPaletteItem[] {
  return [
    ...flowElementPaletteItems(workspaceDefinitions, false, false),
    { id: 'shape:rectangle', label: 'Rectangle', icon: '□', category: 'shapes', payload: { kind: 'shape', shape: 'rectangle' } },
    { id: 'shape:line', label: 'Line', icon: '╱', category: 'shapes', payload: { kind: 'shape', shape: 'line' } }
  ] as ElementPaletteItem[];
}
