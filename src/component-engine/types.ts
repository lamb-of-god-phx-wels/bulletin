export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ComponentDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  componentType?: string;
  instanceId?: string;
  jsonPointer?: string;
  binding?: string;
  sourceId?: string;
}

export interface PathBinding {
  $bind: string;
  default?: JsonValue;
  required?: boolean;
}

export interface ExpressionBinding {
  $expr: {
    op: 'notEmpty' | 'equals' | 'and' | 'or' | 'not';
    args: BoundValue[];
  };
}

export type BoundValue = JsonValue | PathBinding | ExpressionBinding;

export interface ComponentStyle {
  widthPercent?: number;
  gapIn?: number;
  placement?: 'left' | 'center' | 'right';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  paddingIn?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  marginIn?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  fontFamily?: string;
  fontRef?:
    | { kind: 'themeRole'; roleId: string }
    | { kind: 'libraryFont'; family: { id: string; version: number } }
    | { kind: 'legacyCss'; value: string };
  fontSizePt?: number;
  lineHeight?: number;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  textTransform?: 'none' | 'uppercase' | 'small-caps';
  color?: string;
  backgroundColor?: string;
  borderWidthPt?: number;
  borderColor?: string;
  borderRadiusPt?: number;
  keepTogether?: boolean;
  keepWithNext?: boolean;
  pageBreakBefore?: boolean;
  orphanLines?: number;
  widowLines?: number;
}

export interface ComponentStyleOverrides {
  root?: ComponentStyle;
  parts?: Record<string, ComponentStyle>;
}

export interface ComponentReference {
  type: string;
  version: number;
}

export interface ComponentNodeDescriptor {
  type: string;
  id?: string;
  part?: string;
  inputs?: Record<string, BoundValue>;
  when?: BoundValue;
  style?: ComponentStyleOverrides;
  children?: ComponentNodeDescriptor[];
  metadata?: Record<string, JsonValue>;
}

export interface ComponentInstanceV2 extends Omit<ComponentNodeDescriptor, 'type'> {
  component: ComponentReference;
}

export interface ComponentEditorField {
  input: string;
  label: string;
  control: 'text' | 'textarea' | 'structuredText' | 'number' | 'checkbox' | 'select' | 'asset' | 'collection';
  optional?: boolean;
  help?: string;
}

export interface DeclarativeComponentDefinition {
  schemaVersion: 2;
  kind: 'component';
  type: string;
  version: number;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  template: ComponentNodeDescriptor;
  defaultStyles?: ComponentStyleOverrides;
  editor?: {
    icon?: string;
    palette?: boolean;
    fields: ComponentEditorField[];
  };
  sampleInputs?: Record<string, JsonValue>;
}

export interface EvaluationContext {
  data: Readonly<Record<string, unknown>>;
  inputs: Readonly<Record<string, unknown>>;
  locals: Readonly<Record<string, unknown>>;
  computed: Readonly<Record<string, unknown>>;
  environment: Readonly<Record<string, unknown>>;
}

export interface LayoutSource {
  instanceId: string;
  componentType: string;
  part?: string;
}

interface LayoutNodeBase {
  id: string;
  style?: ComponentStyle;
  source: LayoutSource;
}

export interface StackLayoutNode extends LayoutNodeBase {
  type: 'stack';
  children: LayoutNode[];
}

export interface RowLayoutNode extends LayoutNodeBase {
  type: 'row';
  children: LayoutNode[];
}

export interface TextLayoutNode extends LayoutNodeBase {
  type: 'text';
  text: string;
}

export interface StructuredTextInline {
  type: 'text' | 'verseNumber';
  value: string;
  emphasis?: 'bold' | 'italic';
  marks?: Array<'bold' | 'italic' | 'smallCaps' | 'superscript'>;
}

export interface StructuredTextBlock {
  type: 'paragraph' | 'lineBreak';
  inlines?: StructuredTextInline[];
}

export interface StructuredText {
  blocks: StructuredTextBlock[];
}

export interface StructuredTextLayoutNode extends LayoutNodeBase {
  type: 'structuredText';
  content: StructuredText;
}

export interface SpacerLayoutNode extends LayoutNodeBase {
  type: 'spacer';
  sizePt: number;
}

export interface ImageLayoutNode extends LayoutNodeBase {
  type: 'image';
  image: {
    assetId?: string;
    path?: string;
    mediaType?: string;
    altText?: string;
  };
  fit?: 'contain' | 'cover' | 'fill' | 'scale-down';
}

export interface CanvasLayoutNode extends LayoutNodeBase {
  type: 'canvas';
  scene: import('../shared/types.js').CanvasScene;
}

export type LayoutNode = StackLayoutNode | RowLayoutNode | TextLayoutNode | StructuredTextLayoutNode | SpacerLayoutNode | ImageLayoutNode | CanvasLayoutNode;

export interface EvaluationResult {
  node?: LayoutNode;
  diagnostics: ComponentDiagnostic[];
}
