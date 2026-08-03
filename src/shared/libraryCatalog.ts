import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
import { libraryFamilies } from './library.js';
import type {
  LibraryCatalogEntry,
  LibraryCatalogTargetKind,
  LibraryKind,
  LibraryManifestV1,
  PageTemplateV1,
  TemplateV1
} from './types.js';

export type LibraryRecordType = LibraryKind | 'component' | 'page-template' | 'template';

export interface LibraryCatalogRecord {
  key: string;
  targetKind: LibraryCatalogTargetKind;
  targetId: string;
  type: LibraryRecordType;
  title: string;
  sourceTitle: string;
  versionCount: number;
  version?: number;
  folderId?: string;
  builtin?: boolean;
  value: unknown;
}

export const libraryCatalogKey = (targetKind: LibraryCatalogTargetKind, targetId: string) => `${targetKind}:${targetId}`;

export function catalogEntry(library: LibraryManifestV1 | undefined, targetKind: LibraryCatalogTargetKind, targetId: string) {
  return library?.catalog?.find(entry => entry.targetKind === targetKind && entry.targetId === targetId);
}

export function setCatalogEntry(library: LibraryManifestV1, entry: LibraryCatalogEntry) {
  return {
    ...library,
    catalog: [
      ...(library.catalog ?? []).filter(item => item.targetKind !== entry.targetKind || item.targetId !== entry.targetId),
      entry
    ]
  };
}

export function libraryCatalogRecords(
  library: LibraryManifestV1 | undefined,
  pages: PageTemplateV1[] = [],
  builtins: DeclarativeComponentDefinition[] = [],
  templates: TemplateV1[] = []
): LibraryCatalogRecord[] {
  const records: LibraryCatalogRecord[] = [];
  for (const family of libraryFamilies(library?.items ?? [])) {
    const newest = family.versions[0];
    const catalog = catalogEntry(library, 'library-item', family.id);
    records.push({
      key: libraryCatalogKey('library-item', family.id),
      targetKind: 'library-item',
      targetId: family.id,
      type: family.kind,
      title: catalog?.displayName?.trim() || newest.title,
      sourceTitle: newest.title,
      versionCount: family.versions.length,
      version: newest.version,
      folderId: catalog?.folderId,
      value: family
    });
  }
  const componentFamilies = new Map<string, DeclarativeComponentDefinition[]>();
  for (const definition of library?.componentDefinitions ?? []) componentFamilies.set(definition.type, [...(componentFamilies.get(definition.type) ?? []), definition]);
  for (const [type, versions] of componentFamilies) {
    versions.sort((a, b) => b.version - a.version);
    const catalog = catalogEntry(library, 'component', type);
    records.push({
      key: libraryCatalogKey('component', type), targetKind: 'component', targetId: type, type: 'component',
      title: catalog?.displayName?.trim() || versions[0].name, sourceTitle: versions[0].name,
      versionCount: versions.length, version: versions[0].version, folderId: catalog?.folderId, value: versions
    });
  }
  const pageFamilies = new Map<string, PageTemplateV1[]>();
  for (const page of pages) pageFamilies.set(page.id, [...(pageFamilies.get(page.id) ?? []), page]);
  for (const [id, versions] of pageFamilies) {
    versions.sort((a, b) => b.version - a.version || (a.status === 'published' ? -1 : 1));
    const catalog = catalogEntry(library, 'page-template', id);
    records.push({
      key: libraryCatalogKey('page-template', id), targetKind: 'page-template', targetId: id, type: 'page-template',
      title: catalog?.displayName?.trim() || versions[0].name, sourceTitle: versions[0].name,
      versionCount: versions.length, version: versions[0].version, folderId: catalog?.folderId, value: versions
    });
  }
  const templateFamilies = new Map<string, TemplateV1[]>();
  for (const template of templates) templateFamilies.set(template.id, [...(templateFamilies.get(template.id) ?? []), template]);
  for (const [id, versions] of templateFamilies) {
    versions.sort((a, b) => b.version - a.version || (a.status === 'published' ? -1 : 1));
    const catalog = catalogEntry(library, 'template', id);
    records.push({
      key: libraryCatalogKey('template', id), targetKind: 'template', targetId: id, type: 'template',
      title: catalog?.displayName?.trim() || versions[0].name, sourceTitle: versions[0].name,
      versionCount: versions.length, version: versions[0].version, folderId: catalog?.folderId, value: versions
    });
  }
  const workspaceTypes = new Set(componentFamilies.keys());
  for (const definition of builtins.filter(item => !workspaceTypes.has(item.type))) {
    records.push({
      key: `builtin:${definition.type}`, targetKind: 'component', targetId: definition.type, type: 'component',
      title: definition.name, sourceTitle: definition.name, versionCount: 1, version: definition.version,
      builtin: true, value: definition
    });
  }
  return records.sort((a, b) => a.title.localeCompare(b.title));
}

export const libraryRecordTypeLabel: Record<LibraryRecordType, string> = {
  song: 'Songs',
  liturgy: 'Liturgy',
  image: 'Images',
  font: 'Fonts',
  'church-info': 'Church information',
  component: 'Components',
  'page-template': 'Pages',
  template: 'Templates'
};

export const libraryRecordIcon: Record<LibraryRecordType, string> = {
  song: '♫', liturgy: '¶', image: '▧', font: 'A', 'church-info': '⌂',
  component: '◇', 'page-template': '▣', template: '☷'
};
