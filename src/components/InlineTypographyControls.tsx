import { defaultCustomBlockStyle } from '../shared/customBlocks';
import type { BulletinBlock, CustomBlockStyle, TemplateV1 } from '../shared/types';

const fontOptions = [
  { value: 'body', label: 'Template body' },
  { value: 'display', label: 'Template display' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
];

const lineHeightOptions = [
  { value: 1, label: 'Tight' },
  { value: 1.15, label: 'Standard' },
  { value: 1.28, label: 'Comfortable' },
  { value: 1.5, label: 'Relaxed' },
  { value: 2, label: 'Double' },
];

export function effectiveBlockStyle(block: BulletinBlock, template: TemplateV1): CustomBlockStyle {
  const base = block.type === 'custom' ? block.style : undefined;
  return {
    ...defaultCustomBlockStyle,
    fontSizePt: template.theme.bodySizePt,
    lineHeight: template.theme.lineHeight,
    ...base,
    ...block.presentation,
    paddingIn: {
      ...defaultCustomBlockStyle.paddingIn,
      ...base?.paddingIn,
      ...block.presentation?.paddingIn,
    },
    marginIn: {
      ...defaultCustomBlockStyle.marginIn,
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
    'sectionHeading',
    'sermonTitle',
    'richText',
    'responsiveReading',
    'libraryText',
    'announcements',
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

export function InlineTypographyControls({ block, template, label = 'Typography', onChange }: {
  block: BulletinBlock;
  template: TemplateV1;
  label?: string;
  onChange(presentation: CustomBlockStyle): void;
}) {
  const style = effectiveBlockStyle(block, template);
  const customFont = !fontOptions.some(option => option.value === style.fontFamily);
  const customLineHeight = !lineHeightOptions.some(option => option.value === style.lineHeight);
  const change = (changes: Partial<CustomBlockStyle>) =>
    onChange(applyTypographyChange(block, template, changes));

  return <section className="inline-typography" aria-label={label}>
    <div className="inline-typography-title">{label}</div>
    <label className="inline-typography-font">Font
      <select
        aria-label={`${label} font`}
        value={style.fontFamily}
        onChange={event => change({ fontFamily: event.target.value })}
      >
        {customFont && <option value={style.fontFamily}>{style.fontFamily}</option>}
        {fontOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
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
      label="Alignment"
      value={style.textAlign}
      onChange={textAlign => change({ textAlign })}
      options={[
        { value: 'left', label: '≡', title: 'Align left', iconClass: 'align-left' },
        { value: 'center', label: '≡', title: 'Align center', iconClass: 'align-center' },
        { value: 'right', label: '≡', title: 'Align right', iconClass: 'align-right' },
        { value: 'justify', label: '☰', title: 'Justify', iconClass: 'align-justify' },
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
