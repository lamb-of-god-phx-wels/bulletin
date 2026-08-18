import { defaultCustomBlockStyle } from '../shared/customBlocks';
import type { BulletinBlock, CustomBlockStyle, TemplateV1 } from '../shared/types';
import { FontPicker } from './FontPicker';
import { effectiveHeadingLevel } from '../shared/headings';

const lineHeightOptions = [
  { value: 1, label: 'Tight' },
  { value: 1.15, label: 'Standard' },
  { value: 1.28, label: 'Comfortable' },
  { value: 1.5, label: 'Relaxed' },
  { value: 2, label: 'Double' },
];

export function effectiveBlockStyle(block: BulletinBlock, template: TemplateV1): CustomBlockStyle {
  const base = block.type === 'custom' ? block.style : undefined;
  const heading = block.type === 'heading' || block.type === 'sectionHeading'
    ? ({
      h1: { textAlign: 'center' as const, fontFamily: 'display', fontSizePt: 16, fontWeight: 'bold' as const, textTransform: 'none' as const, marginIn: { top: .24, bottom: .14 } },
      h2: { textAlign: 'center' as const, fontFamily: 'display', fontSizePt: 13, fontWeight: 'bold' as const, textTransform: 'none' as const, marginIn: { top: .18, bottom: .24 } },
      h3: { textAlign: 'left' as const, fontFamily: 'body', fontSizePt: 10, fontWeight: 'bold' as const, textTransform: 'uppercase' as const, marginIn: { top: .2, bottom: .08 } },
    })[effectiveHeadingLevel(block)]
    : undefined;
  return {
    ...defaultCustomBlockStyle,
    fontSizePt: template.theme.bodySizePt,
    lineHeight: template.theme.lineHeight,
    ...heading,
    ...base,
    ...block.presentation,
    paddingIn: {
      ...defaultCustomBlockStyle.paddingIn,
      ...base?.paddingIn,
      ...block.presentation?.paddingIn,
    },
    marginIn: {
      ...defaultCustomBlockStyle.marginIn,
      ...heading?.marginIn,
      ...base?.marginIn,
      ...block.presentation?.marginIn,
    },
  };
}

export function applyTypographyChange(
  block: BulletinBlock,
  template: TemplateV1,
  changes: Partial<CustomBlockStyle>,
): CustomBlockStyle {
  return { ...effectiveBlockStyle(block, template), ...changes };
}

export function supportsInlineTypography(block: BulletinBlock): boolean {
  return [
    'heading',
    'sectionHeading', // Legacy read compatibility; normalized to Heading on load.
    'sermonTitle',
    'richText',
    'responsiveReading',
    'libraryText',
    'announcements',
    'list',
    'copyright',
    'custom',
  ].includes(block.type);
}

function ToggleGroup<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title: string; iconClass?: string }>;
  onChange(value: T): void;
}) {
  return <fieldset className="inline-typography-group">
    <legend>{label}</legend>
    <div role="group" aria-label={label}>
      {options.map(option => <button
        type="button"
        className={`${value === option.value ? 'active' : ''} ${option.iconClass ?? ''}`.trim()}
        aria-label={option.title}
        aria-pressed={value === option.value}
        title={option.title}
        key={option.value}
        onClick={() => onChange(option.value)}
      >{option.label}</button>)}
    </div>
  </fieldset>;
}

export function InlineTypographyControls({ block, template, label = 'Typography', verticalAlign, onVerticalAlignChange, onChange }: {
  block: BulletinBlock;
  template: TemplateV1;
  label?: string;
  verticalAlign?: CustomBlockStyle['verticalAlign'];
  onVerticalAlignChange?(verticalAlign: CustomBlockStyle['verticalAlign']): void;
  onChange(presentation: CustomBlockStyle): void;
}) {
  const style = effectiveBlockStyle(block, template);
  const customLineHeight = !lineHeightOptions.some(option => option.value === style.lineHeight);
  const change = (changes: Partial<CustomBlockStyle>) =>
    onChange(applyTypographyChange(block, template, {
      ...(verticalAlign ? { verticalAlign } : {}),
      ...changes,
    }));

  return <section className="inline-typography" aria-label={label}>
    <div className="inline-typography-title">{label}</div>
    <div className="inline-typography-font"><FontPicker label={`${label} font`} fontRef={style.fontRef} fontFamily={style.fontFamily} onChange={fontRef => change({ fontRef, fontFamily: undefined })} /></div>
    <label className="inline-typography-size">Size
      <input
        aria-label={`${label} size`}
        type="number"
        min={6}
        max={72}
        step={.5}
        value={style.fontSizePt}
        onChange={event => {
          if (Number.isFinite(event.currentTarget.valueAsNumber))
            change({ fontSizePt: event.currentTarget.valueAsNumber });
        }}
      />
    </label>
    <label className="inline-typography-spacing">Line spacing
      <select
        aria-label={`${label} line spacing`}
        value={style.lineHeight}
        onChange={event => change({ lineHeight: Number(event.target.value) })}
      >
        {customLineHeight && <option value={style.lineHeight}>Custom ({style.lineHeight})</option>}
        {lineHeightOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
    <ToggleGroup
      label="Horizontal"
      value={style.textAlign}
      onChange={textAlign => change({ textAlign })}
      options={[
        { value: 'left', label: '≡', title: 'Align left', iconClass: 'align-left' },
        { value: 'center', label: '≡', title: 'Align center', iconClass: 'align-center' },
        { value: 'right', label: '≡', title: 'Align right', iconClass: 'align-right' },
        { value: 'justify', label: '☰', title: 'Justify', iconClass: 'align-justify' },
      ]}
    />
    <ToggleGroup
      label="Vertical"
      value={verticalAlign ?? style.verticalAlign}
      onChange={value => onVerticalAlignChange ? onVerticalAlignChange(value) : change({ verticalAlign: value })}
      options={[
        { value: 'top', label: 'T', title: 'Align top', iconClass: 'align-top' },
        { value: 'middle', label: 'T', title: 'Align middle', iconClass: 'align-middle' },
        { value: 'bottom', label: 'T', title: 'Align bottom', iconClass: 'align-bottom' },
      ]}
    />
    <div className="inline-typography-style" role="group" aria-label="Style">
      <span>Style</span>
      <div>
        <button
          type="button"
          className={style.fontWeight === 'bold' ? 'active typography-bold' : 'typography-bold'}
          aria-label="Bold"
          aria-pressed={style.fontWeight === 'bold'}
          title="Bold"
          onClick={() => change({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
        >B</button>
        <button
          type="button"
          className={style.fontStyle === 'italic' ? 'active typography-italic' : 'typography-italic'}
          aria-label="Italic"
          aria-pressed={style.fontStyle === 'italic'}
          title="Italic"
          onClick={() => change({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
        >I</button>
      </div>
    </div>
    <ToggleGroup
      label="Capitalization"
      value={style.textTransform}
      onChange={textTransform => change({ textTransform })}
      options={[
        { value: 'none', label: 'Aa', title: 'Regular capitalization' },
        { value: 'small-caps', label: 'Aᴀ', title: 'Small caps' },
        { value: 'uppercase', label: 'AA', title: 'Uppercase' },
      ]}
    />
  </section>;
}
