export type Marks = Array<'bold' | 'italic' | 'smallCaps' | 'superscript'>;

export interface TextRun { type: 'text'; text: string; marks?: Marks }
export interface SymbolRun { type: 'symbol'; name: 'cross' }
export interface LineBreakRun { type: 'lineBreak' }
export type Inline = TextRun | SymbolRun | LineBreakRun;

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
  role?: 'header' | 'body';
  weeklyEditable?: boolean;
  layout?: LayoutHints;
  presentation?: Partial<CustomBlockStyle>;
}

export interface TitlePageBlock extends BlockBase { type: 'titlePage'; asset?: AssetRef; seriesAsset?: AssetRef; churchLogoAsset?: AssetRef }
export type CanvasCoordinateSpace = 'fullPage' | 'contentBox';
export type CanvasTextBinding = 'info.title' | 'info.date' | 'info.churchWeek' | 'info.series' | 'church.name';
export interface CanvasGeometry { x: number; y: number; width: number; height: number }
export interface CanvasTextSource {
  literal?: Paragraph[];
  binding?: CanvasTextBinding;
  override?: Paragraph[];
  dateFormat?: 'long' | 'medium' | 'short' | 'iso';
}
interface CanvasElementBase extends CanvasGeometry {
  id: string;
  name?: string;
  locked?: boolean;
  groupId?: string;
}
export interface CanvasTextElement extends CanvasElementBase {
  type: 'text';
  source: CanvasTextSource;
  paddingIn?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  fontFamily?: string;
  fontSizePt?: number;
  lineHeight?: number;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  color?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  overflow?: 'autoHeight' | 'shrinkToFit' | 'fixed';
}
export interface CanvasImageElement extends CanvasElementBase {
  type: 'image';
  asset: AssetRef;
  fit?: 'contain' | 'cover' | 'fill';
}
export interface CanvasRectangleElement extends CanvasElementBase {
  type: 'rectangle';
  fill?: string;
  borderColor?: string;
  borderWidthPt?: number;
}
export interface CanvasLineElement extends CanvasElementBase {
  type: 'line';
  color?: string;
  widthPt?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
}
export type CanvasElement = CanvasTextElement | CanvasImageElement | CanvasRectangleElement | CanvasLineElement;
export interface CanvasScene {
  coordinateSpace: CanvasCoordinateSpace;
  background?: { color?: string; asset?: AssetRef; fit?: 'contain' | 'cover' | 'fill' };
  elements: CanvasElement[];
}
export interface CanvasCoverBlock extends BlockBase {
  type: 'canvasCover';
  scene: CanvasScene;
  weeklyScene?: CanvasScene;
  weeklyUnlockedElementIds?: string[];
}
export interface ChurchInfoBlock extends BlockBase { type: 'churchInfo'; libraryItemId?: string; libraryItemVersion?: number; heroAsset?: AssetRef; children?: BulletinBlock[] }
export interface HeadingBlock extends BlockBase { type: 'heading' | 'sectionHeading'; text: string }
export interface ParagraphBlock extends BlockBase { type: 'paragraph'; children: RichTextBlock[] }
export type ScriptureElementRole = 'heading' | 'reference' | 'caption' | 'body';
export interface RichTextBlock extends BlockBase {
  type: 'richText';
  role?: 'header' | 'body';
  scriptureRole?: ScriptureElementRole;
  content: Paragraph[];
}
export interface SermonTitleBlock extends BlockBase { type: 'sermonTitle'; text: string }
export type ResponsiveReadingRole = 'leader' | 'follower';
export interface ResponsiveReadingEntry {
  reader: string;
  role?: ResponsiveReadingRole;
  content: Paragraph[];
}
export interface ResponsiveReadingBlock extends BlockBase {
  type: 'responsiveReading';
  entries: ResponsiveReadingEntry[];
}
export interface ScriptureBlock extends BlockBase {
  type: 'scriptureReading';
  reference: string;
  translation: string;
  caption?: string;
  headingReferenceLayout?: 'inline' | 'stacked';
  headingReferenceGapIn?: number;
  elements?: Partial<Record<ScriptureElementRole, { presentation?: Partial<CustomBlockStyle>; layout?: LayoutHints }>>;
  resolved?: { content: Paragraph[]; source: 'bible-gateway-web' | 'bible-gateway' | 'manual'; retrievedAt: string; attribution: string };
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
  assetHeightIn?: number;
  showHeading?: boolean;
  contentOverride?: Paragraph[];
}
export interface LibraryTextBlock extends BlockBase { type: 'libraryText'; libraryItemId: string; libraryItemVersion?: number; title?: string; contentOverride?: Paragraph[] }
export interface AnnouncementsBlock extends BlockBase {
  type: 'announcements';
  items: Array<{ id: string; title: string; content: Paragraph[]; asset?: AssetRef; assetSide?: 'left' | 'right' }>;
}
export interface CopyrightBlock extends BlockBase { type: 'copyright'; extra?: Paragraph[]; suppressGeneratedNotices?: boolean }
export interface FullPageAssetBlock extends BlockBase { type: 'fullPageAsset'; asset: AssetRef; replaces?: string }
export interface SpacerBlock extends BlockBase { type: 'spacer'; size: 'small' | 'medium' | 'large' }
export interface GroupBlock extends BlockBase { type: 'group'; children: BulletinBlock[] }

export type CustomBindingSource = 'weekly' | 'info.title' | 'info.date' | 'info.churchWeek' | 'info.series' | 'church.name';
export interface CustomBlockBinding {
  key: string;
  label: string;
  source: CustomBindingSource;
  defaultValue?: string;
  multiline?: boolean;
}
export interface CustomBlockStyle {
  widthPercent: number;
  placement: 'left' | 'center' | 'right';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  paddingIn: { top: number; right: number; bottom: number; left: number };
  marginIn: { top: number; bottom: number };
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textTransform: 'none' | 'uppercase' | 'small-caps';
  color: string;
  backgroundColor?: string;
  borderWidthPt: number;
  borderColor: string;
  borderRadiusPt: number;
}
export interface CustomBlock extends BlockBase {
  type: 'custom';
  name: string;
  showName?: boolean;
  layoutText: string;
  bindings: CustomBlockBinding[];
  values?: Record<string, string>;
  style?: CustomBlockStyle;
}

export type BulletinBlock = TitlePageBlock | CanvasCoverBlock | ChurchInfoBlock | HeadingBlock | ParagraphBlock | RichTextBlock |
  SermonTitleBlock | ResponsiveReadingBlock | ScriptureBlock | SongBlock | LibraryTextBlock |
  AnnouncementsBlock | CopyrightBlock | FullPageAssetBlock | SpacerBlock | GroupBlock | CustomBlock;

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
  layout?: { marginIn?: number };
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

export type LibraryKind = 'song' | 'liturgy' | 'image' | 'font' | 'church-info';
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
export interface ChurchWeekName {
  sourceName: string;
  displayName: string;
}
export interface LibraryManifestV1 {
  schemaVersion: 1;
  name: string;
  items: LibraryItemV1[];
  churchWeekNames?: ChurchWeekName[];
  componentDefinitions?: DeclarativeComponentDefinition[];
}

export interface ValidationIssue { path: string; message: string }
export interface WorkspaceSummary { root: string; bulletins: Array<{ path: string; document: BulletinDocumentV1 }>; templates: Array<{ path: string; template: TemplateV1 }>; library?: LibraryManifestV1 }

export interface BulletinApi {
  platform: 'electron' | 'browser';
  chooseWorkspace(): Promise<string | null>;
  listWorkspaces?(): Promise<Array<{ root: string; name: string }>>;
  createWorkspace?(name: string): Promise<string>;
  openWorkspace(root: string): Promise<WorkspaceSummary>;
  saveBulletin(root: string, relativePath: string, document: BulletinDocumentV1, expectedRevision: number): Promise<{ revision: number; updatedAt: string }>;
  deleteBulletin(root: string, relativePath: string): Promise<void>;
  saveTemplate(root: string, template: TemplateV1): Promise<string>;
  deleteTemplate(root: string, relativePath: string): Promise<void>;
  saveLibrary(root: string, library: LibraryManifestV1): Promise<void>;
  createRevision(root: string, relativePath: string, document: BulletinDocumentV1, label: string): Promise<string>;
  exportPdf(root: string, relativePath: string, document: BulletinDocumentV1): Promise<string | null>;
  importAsset(root: string, targetFolder: string): Promise<AssetRef | null>;
  readAsset(root: string, relativePath: string): Promise<string>;
  lookupScripture(input: { reference: string; translation: string }): Promise<ScriptureBlock['resolved']>;
  openScripture(reference: string, translation: string): Promise<void>;
}
import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
