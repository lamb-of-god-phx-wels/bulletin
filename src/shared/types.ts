export type Marks = Array<'bold' | 'italic' | 'smallCaps' | 'superscript'>;

export interface TextRun { type: 'text'; text: string; marks?: Marks }
export interface SymbolRun { type: 'symbol'; name: 'cross' }
export interface LineBreakRun { type: 'lineBreak' }
export type Inline = TextRun | SymbolRun | LineBreakRun;

export interface Paragraph {
  type: 'paragraph';
  align?: 'left' | 'center' | 'right';
  breakBefore?: 'line';
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

export interface UnsupportedLegacyCoverBlock extends BlockBase { type: 'titlePage' | 'canvasCover' }
export type CanvasCoordinateSpace = 'fullPage' | 'contentBox';
export type CanvasTextBinding = 'info.title' | 'info.date' | 'info.churchWeek' | 'info.churchEvent' | 'info.series' | 'church.name';
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
  rotationDeg?: number;
}
export interface CanvasNativeElement extends CanvasElementBase {
  type: 'block';
  block: BulletinBlock;
  sizing?: 'autoHeight' | 'fixed';
  verticalAlign?: 'top' | 'middle' | 'bottom';
}
export interface CanvasShapeElement extends CanvasElementBase {
  type: 'shape';
  shape: 'rectangle' | 'line';
  fill?: string;
  borderColor?: string;
  borderWidthPt?: number;
  color?: string;
  widthPt?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  rotationDeg?: number;
}
export type CanvasElement =
  | CanvasNativeElement
  | CanvasShapeElement
  | CanvasTextElement
  | CanvasImageElement
  | CanvasRectangleElement
  | CanvasLineElement;
export interface CanvasScene {
  schemaVersion?: 2;
  coordinateSpace: CanvasCoordinateSpace;
  background?: { color?: string; asset?: AssetRef; fit?: 'contain' | 'cover' | 'fill' };
  elements: CanvasElement[];
}
export interface CanvasBlock extends BlockBase {
  type: 'canvas';
  scene: CanvasScene;
  heightIn: number;
  widthMode?: 'contentBox' | 'fullPage';
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
  binding?: CanvasTextBinding;
  bindingOverride?: Paragraph[];
  dateFormat?: 'long' | 'medium' | 'short' | 'iso';
}
export interface SermonTitleBlock extends BlockBase { type: 'sermonTitle'; text: string }
export type ResponsiveReadingRole = 'leader' | 'follower' | 'all';
export interface ResponsiveReadingSettings {
  labels: Record<ResponsiveReadingRole, string>;
}
export interface ResponsiveReadingEntry {
  reader: string;
  role?: ResponsiveReadingRole;
  readerMode?: 'configured' | 'custom';
  content: Paragraph[];
}
export interface ResponsiveReadingBlock extends BlockBase {
  type: 'responsiveReading';
  heading?: HeadingBlock;
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
  elements?: Partial<Record<'header' | 'title' | 'body', { presentation?: Partial<CustomBlockStyle> }>>;
}
export interface LibraryTextBlock extends BlockBase { type: 'libraryText'; libraryItemId: string; libraryItemVersion?: number; title?: string; contentOverride?: Paragraph[] }
export interface AnnouncementsBlock extends BlockBase {
  type: 'announcements';
  items: Array<{ id: string; title: string; content: Paragraph[]; asset?: AssetRef; assetSide?: 'left' | 'right' }>;
}
export interface CopyrightBlock extends BlockBase { type: 'copyright'; extra?: Paragraph[]; suppressGeneratedNotices?: boolean }
export interface ImageBlock extends BlockBase { type: 'image'; asset: AssetRef; fit?: 'contain' | 'cover' | 'fill'; heightIn?: number; alt?: string }
export interface FullPageAssetBlock extends BlockBase { type: 'fullPageAsset'; asset: AssetRef; replaces?: string }
export interface SpacerBlock extends BlockBase { type: 'spacer'; size: 'small' | 'medium' | 'large' }
export interface GroupBlock extends BlockBase {
  type: 'group';
  children: BulletinBlock[];
  layoutMode?: 'stack' | 'grid' | 'table';
  columns?: number;
  gapIn?: number;
}
export type PageMarginSetting =
  | { mode: 'inherit'; referenceMarginIn: number }
  | { mode: 'fixed'; marginIn: number };
export interface TemplatePageBlock extends BlockBase {
  type: 'templatePage';
  source: { id: string; version: number };
  sourceDigest: string;
  name: string;
  pageLayout?: 'canvas' | 'regular';
  margin: PageMarginSetting;
  blocks: BulletinBlock[];
}

export type CustomBindingSource = 'weekly' | 'info.title' | 'info.date' | 'info.churchWeek' | 'info.churchEvent' | 'info.series' | 'church.name';
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
  verticalAlign: 'top' | 'middle' | 'bottom';
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

export type BulletinBlock = UnsupportedLegacyCoverBlock | CanvasBlock | TemplatePageBlock | ChurchInfoBlock | HeadingBlock | ParagraphBlock | RichTextBlock |
  SermonTitleBlock | ResponsiveReadingBlock | ScriptureBlock | SongBlock | LibraryTextBlock |
  AnnouncementsBlock | CopyrightBlock | ImageBlock | FullPageAssetBlock | SpacerBlock | GroupBlock | CustomBlock;

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
  info: { title: string; series?: string; date: string; churchWeek: string; churchEventId?: string };
  layout?: { marginIn?: number };
  responsiveReading?: ResponsiveReadingSettings;
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
  responsiveReading?: ResponsiveReadingSettings;
  starterBlocks: BulletinBlock[];
  filler: { kind: 'blank' | 'asset'; asset?: AssetRef };
  updatedAt: string;
}

export interface PageTemplateV1 {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'published';
  layout?: 'canvas' | 'regular';
  margin: PageMarginSetting;
  blocks: BulletinBlock[];
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
export interface LibraryFolder {
  id: string;
  name: string;
  parentId?: string;
}
export type LibraryCatalogTargetKind = 'library-item' | 'component' | 'page-template' | 'calendar-event';
export interface LibraryCatalogEntry {
  targetKind: LibraryCatalogTargetKind;
  targetId: string;
  folderId?: string;
  displayName?: string;
}
export interface LibraryTrashSelection {
  folderIds: string[];
  records: Array<Pick<LibraryCatalogEntry, 'targetKind' | 'targetId'>>;
}
/** Legacy image-only organization metadata, normalized on load. */
export type LibraryImageFolder = LibraryFolder;
/** Legacy image-only organization metadata, normalized on load. */
export interface LibraryImageCatalogEntry {
  imageId: string;
  folderId?: string;
  displayName?: string;
}
export interface ChurchWeekName {
  sourceName: string;
  displayName: string;
}
export type ChurchLectionaryYear = 'A' | 'B' | 'C';
export type ChurchEventRule =
  | { kind: 'once'; date: string }
  | { kind: 'annualDate'; month: number; day: number }
  | { kind: 'nthWeekday'; month?: number; weekday: number; ordinal: 1 | 2 | 3 | 4 | 5 | -1 }
  | { kind: 'weekdayOnOrAfter'; month: number; day: number; weekday: number }
  | { kind: 'weekdayInDateRange'; startMonth: number; startDay: number; endMonth: number; endDay: number; weekday: number; afterEventId?: string }
  | { kind: 'easter' }
  | { kind: 'relativeDays'; eventId: string; days: number; beforeEventId?: string }
  | { kind: 'weekdayRelative'; eventId: string; weekday: number; ordinal: 1 | 2 | 3 | 4 | 5; direction: 'before' | 'after' };
export interface ChurchCalendarEvent {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  rules: ChurchEventRule[];
  lectionaryYears?: ChurchLectionaryYear[];
  aliases?: string[];
  needsRule?: boolean;
  nameMode?: 'sundayAfterPentecost';
}
export type SharedRecordKind = 'bulletin' | 'template' | 'page-template' | 'library-item' | 'library-folder' | 'library-catalog' | 'image-folder' | 'image-catalog' | 'church-week' | 'calendar-event' | 'component';
export interface WorkspaceConflict {
  id: string;
  kind: SharedRecordKind;
  recordId: string;
  paths: string[];
  message: string;
}
export interface ArchivedWorkspaceRecord {
  id: string;
  kind: SharedRecordKind;
  label: string;
  path: string;
  originalPath: string;
  archivedAt: string;
}
export interface WorkspaceSyncStatus {
  schemaVersion: 2;
  lastScannedAt: string;
  conflicts: WorkspaceConflict[];
  unavailableAssets: string[];
  archivedRecords: ArchivedWorkspaceRecord[];
}
export interface WorkspaceCompatibility {
  currentVersion: string;
  minimumAppVersion?: string;
  writable: boolean;
  message?: string;
}
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'disabled';
export interface AppUpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  percent?: number;
  message?: string;
  checkedAt?: string;
}
export interface EditingState {
  bulletinDirty: boolean;
  templateDirty: boolean;
  auxiliaryDirty: boolean;
}
export interface LibraryManifestV1 {
  schemaVersion: 1;
  name: string;
  items: LibraryItemV1[];
  folders?: LibraryFolder[];
  catalog?: LibraryCatalogEntry[];
  imageFolders?: LibraryImageFolder[];
  imageCatalog?: LibraryImageCatalogEntry[];
  churchWeekNames?: ChurchWeekName[];
  calendarEvents?: ChurchCalendarEvent[];
  componentDefinitions?: DeclarativeComponentDefinition[];
}

export interface ValidationIssue { path: string; message: string }
export interface WorkspaceSummary {
  root: string;
  bulletins: Array<{ path: string; document: BulletinDocumentV1 }>;
  revisions?: BulletinRevisionRecord[];
  templates: Array<{ path: string; template: TemplateV1 }>;
  pageTemplates: Array<{ path: string; pageTemplate: PageTemplateV1 }>;
  library?: LibraryManifestV1;
  sync?: WorkspaceSyncStatus;
  compatibility?: WorkspaceCompatibility;
}
export interface BulletinRevisionRecord {
  path: string;
  bulletinPath: string;
  label: string;
  createdAt: string;
  document: BulletinDocumentV1;
}
export interface WorkspaceChange { root: string; paths: string[]; occurredAt: string }

export interface BulletinApi {
  platform: 'electron' | 'browser';
  chooseWorkspace(): Promise<string | null>;
  listWorkspaces?(): Promise<Array<{ root: string; name: string }>>;
  createWorkspace?(name: string): Promise<string>;
  openWorkspace(root: string): Promise<WorkspaceSummary>;
  saveBulletin(root: string, relativePath: string, document: BulletinDocumentV1, expectedRevision: number): Promise<{ revision: number; updatedAt: string }>;
  deleteBulletin(root: string, relativePath: string): Promise<void>;
  saveTemplate(root: string, template: TemplateV1, expectedUpdatedAt?: string, force?: boolean): Promise<string>;
  deleteTemplate(root: string, relativePath: string): Promise<void>;
  savePageTemplate(root: string, pageTemplate: PageTemplateV1, expectedUpdatedAt?: string, force?: boolean): Promise<string>;
  deletePageTemplate(root: string, relativePath: string): Promise<void>;
  saveLibrary(root: string, library: LibraryManifestV1, previous?: LibraryManifestV1, force?: boolean): Promise<void>;
  trashLibraryImages?(root: string, folderIds: string[], imageIds: string[], previous: LibraryManifestV1): Promise<LibraryManifestV1>;
  trashLibraryRecords?(root: string, selection: LibraryTrashSelection, previous: LibraryManifestV1): Promise<{ library: LibraryManifestV1; pageTemplateIds: string[] }>;
  onWorkspaceChanged?(listener: (change: WorkspaceChange) => void): () => void;
  getUpdateStatus?(): Promise<AppUpdateStatus>;
  checkForUpdates?(): Promise<AppUpdateStatus>;
  installUpdate?(): Promise<void>;
  reportEditingState?(state: EditingState): void;
  onCloseRequested?(listener: () => void): () => void;
  confirmClose?(): void;
  onUpdateStatus?(listener: (status: AppUpdateStatus) => void): () => void;
  restoreArchived?(root: string, record: ArchivedWorkspaceRecord): Promise<void>;
  permanentlyDeleteArchived?(root: string, record: ArchivedWorkspaceRecord): Promise<void>;
  resolveWorkspaceConflict?(root: string, conflict: WorkspaceConflict, keepPath: string): Promise<void>;
  createRevision(root: string, relativePath: string, document: BulletinDocumentV1, label: string): Promise<string>;
  exportPdf(root: string, relativePath: string, document: BulletinDocumentV1): Promise<string | null>;
  importAsset(root: string, targetFolder: string): Promise<AssetRef | null>;
  readAsset(root: string, relativePath: string): Promise<string>;
  lookupScripture(input: { reference: string; translation: string }): Promise<ScriptureBlock['resolved']>;
  openScripture(reference: string, translation: string): Promise<void>;
}
import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
