export type Marks = Array<'bold' | 'italic' | 'smallCaps'>;

export interface TextRun { type: 'text'; text: string; marks?: Marks }
export interface SymbolRun { type: 'symbol'; name: 'cross' }
export type Inline = TextRun | SymbolRun;

export interface Paragraph {
  type: 'paragraph';
  align?: 'left' | 'center' | 'right';
  children: Inline[];
}

export interface LayoutHints {
  pageBreakBefore?: boolean;
  keepTogether?: boolean;
  density?: 'normal' | 'compact';
  fit?: 'contain' | 'cover';
  cropAnchor?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

interface BlockBase {
  id: string;
  label?: string;
  weeklyEditable?: boolean;
  layout?: LayoutHints;
}

export interface TitlePageBlock extends BlockBase { type: 'titlePage'; asset?: AssetRef }
export interface ChurchInfoBlock extends BlockBase { type: 'churchInfo'; libraryItemId?: string; libraryItemVersion?: number }
export interface HeadingBlock extends BlockBase { type: 'heading' | 'sectionHeading'; text: string }
export interface RichTextBlock extends BlockBase { type: 'richText'; content: Paragraph[] }
export interface SermonTitleBlock extends BlockBase { type: 'sermonTitle'; text: string }
export interface ResponsiveReadingBlock extends BlockBase {
  type: 'responsiveReading';
  entries: Array<{ reader: string; content: Paragraph[] }>;
}
export interface ScriptureBlock extends BlockBase {
  type: 'scriptureReading';
  reference: string;
  translation: string;
  caption?: string;
  resolved?: { content: Paragraph[]; source: 'bible-gateway' | 'manual'; retrievedAt: string; attribution: string };
}
export interface SongBlock extends BlockBase {
  type: 'song';
  libraryItemId: string;
  libraryItemVersion?: number;
  title?: string;
  songType: 'hymn' | 'psalm' | 'song';
  selection: { mode: 'all' } | { mode: 'verses'; verses: number[] };
  renderMode: 'lyrics' | 'asset';
  asset?: AssetRef;
}
export interface LibraryTextBlock extends BlockBase { type: 'libraryText'; libraryItemId: string; libraryItemVersion?: number; title?: string }
export interface AnnouncementsBlock extends BlockBase {
  type: 'announcements';
  items: Array<{ id: string; title: string; content: Paragraph[] }>;
}
export interface CopyrightBlock extends BlockBase { type: 'copyright'; extra?: Paragraph[] }
export interface FullPageAssetBlock extends BlockBase { type: 'fullPageAsset'; asset: AssetRef; replaces?: string }
export interface SpacerBlock extends BlockBase { type: 'spacer'; size: 'small' | 'medium' | 'large' }

export type BulletinBlock = TitlePageBlock | ChurchInfoBlock | HeadingBlock | RichTextBlock |
  SermonTitleBlock | ResponsiveReadingBlock | ScriptureBlock | SongBlock | LibraryTextBlock |
  AnnouncementsBlock | CopyrightBlock | FullPageAssetBlock | SpacerBlock;

export interface AssetRef {
  path: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml' | 'application/pdf';
  page?: number;
  alt?: string;
}

export interface BulletinDocumentV1 {
  schemaVersion: 1;
  id: string;
  revision: number;
  template: { id: string; version: number };
  church: { name: string };
  info: { title: string; series?: string; date: string; churchWeek: string };
  blocks: BulletinBlock[];
  sourceNotes?: string;
  updatedAt: string;
}

export interface ThemeV1 {
  bodyFont: string;
  displayFont: string;
  ink: string;
  accent: string;
  bodySizePt: number;
  lineHeight: number;
  marginIn: number;
}

export interface TemplateV1 {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'published';
  page: { widthIn: 7; heightIn: 8.5; pageMultiple: 4 };
  theme: ThemeV1;
  starterBlocks: BulletinBlock[];
  filler: { kind: 'blank' | 'asset'; asset?: AssetRef };
  updatedAt: string;
}

export type LibraryKind = 'song' | 'liturgy' | 'image' | 'font' | 'church-info' | 'music';
export interface LibraryItemV1 {
  id: string;
  version: number;
  kind: LibraryKind;
  title: string;
  aliases?: string[];
  content?: Paragraph[];
  assets?: Array<AssetRef & { variant?: string }>;
  license?: { notice: string; licenseNumber?: string };
}
export interface LibraryManifestV1 { schemaVersion: 1; name: string; items: LibraryItemV1[] }

export interface ValidationIssue { path: string; message: string }
export interface WorkspaceSummary { root: string; bulletins: Array<{ path: string; document: BulletinDocumentV1 }>; templates: Array<{ path: string; template: TemplateV1 }>; library?: LibraryManifestV1 }

export interface BulletinApi {
  chooseWorkspace(): Promise<string | null>;
  openWorkspace(root: string): Promise<WorkspaceSummary>;
  saveBulletin(root: string, relativePath: string, document: BulletinDocumentV1, expectedRevision: number): Promise<{ revision: number; updatedAt: string }>;
  saveTemplate(root: string, template: TemplateV1): Promise<string>;
  saveLibrary(root: string, library: LibraryManifestV1): Promise<void>;
  createRevision(root: string, relativePath: string, document: BulletinDocumentV1, label: string): Promise<string>;
  exportPdf(root: string, relativePath: string, document: BulletinDocumentV1): Promise<string | null>;
  importAsset(root: string, targetFolder: string): Promise<AssetRef | null>;
  readAsset(root: string, relativePath: string): Promise<string>;
  lookupScripture(input: { reference: string; translation: string; username?: string; password?: string }): Promise<ScriptureBlock['resolved']>;
}
