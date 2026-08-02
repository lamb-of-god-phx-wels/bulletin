import { useEffect, useRef, useState } from 'react';
import type { BulletinDocumentV1, CanvasTextBinding, CustomPropertyDefinition, CustomPropertyValue, PageTemplateV1, TemplateV1 } from '../shared/types';
import { builtInTextBindings, customPropertyBinding, customPropertyUsages, defaultValueForCustomProperty, effectiveCustomPropertyDefinitions, effectiveCustomPropertyValue, isCustomPropertyBinding, synchronizeCustomPropertyBindings } from '../shared/customProperties';
import { randomId } from '../shared/id';

const encodedBinding = (binding: CanvasTextBinding | undefined) => !binding ? '' : isCustomPropertyBinding(binding) ? `custom:${binding.propertyId}` : `builtin:${binding}`;
const propertyTypeLabel = (valueType: CustomPropertyDefinition['valueType']) => valueType === 'boolean' ? 'Toggle' : valueType === 'string' ? 'Text' : 'Number';

export function CustomPropertyBindingSelect({ value, template, booleanOnly = false, onChange }: {
  value?: CanvasTextBinding;
  template: TemplateV1;
  booleanOnly?: boolean;
  onChange(value?: CanvasTextBinding): void;
}) {
  return <select value={encodedBinding(value)} onChange={event => {
    const encoded = event.target.value;
    if (!encoded) { onChange(undefined); return; }
    if (encoded.startsWith('builtin:')) { onChange(encoded.slice(8) as Exclude<CanvasTextBinding, object>); return; }
    const property = template.customProperties?.find(item => item.id === encoded.slice(7));
    onChange(property ? customPropertyBinding(property) : undefined);
  }}>
    {!booleanOnly && <><option value="">Literal text</option>{builtInTextBindings.map(option => <option value={`builtin:${option.value}`} key={option.value}>{option.label}</option>)}</>}
    {(template.customProperties ?? []).filter(property => !booleanOnly || property.valueType === 'boolean').map(property => <option value={`custom:${property.id}`} key={property.id}>{property.name}{booleanOnly ? '' : ` · ${propertyTypeLabel(property.valueType)}`}</option>)}
  </select>;
}

function PropertyInput({ property, value, onChange }: { property: CustomPropertyDefinition; value: CustomPropertyValue; onChange(value: CustomPropertyValue): void }) {
  if (property.valueType === 'boolean') {
    const checked = Boolean(value);
    return <button type="button" role="switch" aria-label={`${property.name} value`} aria-checked={checked} className="property-toggle" onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
  }
  if (property.valueType === 'number') return <input type="number" aria-label={`${property.name} value`} value={typeof value === 'number' ? value : 0} onChange={event => Number.isFinite(event.currentTarget.valueAsNumber) && onChange(event.currentTarget.valueAsNumber)} />;
  return <input aria-label={`${property.name} value`} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} />;
}

function AddPropertyControls({ onAdd }: { onAdd(valueType: CustomPropertyDefinition['valueType']): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('keydown', keyDown);
    return () => { document.removeEventListener('pointerdown', pointerDown); document.removeEventListener('keydown', keyDown); };
  }, [open]);
  const add = (valueType: CustomPropertyDefinition['valueType']) => { onAdd(valueType); setOpen(false); };
  return <div className="property-add-controls" ref={root}>
    <button className="secondary property-add-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(current => !current)}>＋ Property</button>
    {open && <div className="property-add-menu" role="menu" aria-label="Property type"><button role="menuitem" onClick={() => add('boolean')}>Toggle</button><button role="menuitem" onClick={() => add('string')}>Text</button><button role="menuitem" onClick={() => add('number')}>Number</button></div>}
  </div>;
}

function TrashIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6 4.5V3h4v1.5m-5.5 0 .5 8h6l.5-8M7 6.5v4M9 6.5v4" /></svg>;
}

function ThisSundayToggle({ property, onChange }: { property: CustomPropertyDefinition; onChange(include: boolean): void }) {
  return <div className="property-this-sunday-line"><span>Include in <i>This Sunday</i></span><button type="button" role="switch" aria-label={`Include ${property.name} in This Sunday`} aria-checked={Boolean(property.includeInThisSunday)} className="property-toggle" onClick={() => onChange(!property.includeInThisSunday)}><span aria-hidden="true" /></button></div>;
}

export function TemplatePropertiesPanel({ template, onChange }: { template: TemplateV1; onChange(template: TemplateV1): void }) {
  const properties = template.customProperties ?? [];
  const [focusPropertyId, setFocusPropertyId] = useState<string>();
  const update = (id: string, changes: Partial<CustomPropertyDefinition>) => onChange({ ...template, status: 'draft', customProperties: properties.map(property => property.id === id ? { ...property, ...changes } : property) });
  return <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup custom-properties-panel">
    <summary><div><div className="eyebrow">Template</div><b>Properties</b></div></summary>
    <div className="collapsible-editor-fields custom-properties-list">
      {properties.map(property => {
        const usages = customPropertyUsages(template.starterBlocks, property.id);
        return <div className="custom-property-row" key={property.id}>
          <div className="custom-property-definition-line"><label><span>Name</span><input autoFocus={property.id === focusPropertyId} value={property.name} onFocus={event => { if (property.id === focusPropertyId) { event.currentTarget.select(); setFocusPropertyId(undefined); } }} onChange={event => update(property.id, { name: event.target.value })} /></label>{property.valueType === 'boolean' && <PropertyInput property={property} value={property.defaultValue} onChange={defaultValue => update(property.id, { defaultValue })} />}<button className="property-delete-button" aria-label={`Delete ${property.name}`} disabled={usages.length > 0} title={usages.length ? `Used by ${usages.map(item => item.label).join(', ')}` : 'Delete property'} onClick={() => onChange({ ...template, status: 'draft', customProperties: properties.filter(item => item.id !== property.id) })}><TrashIcon /></button></div>
          {property.valueType !== 'boolean' && <div className="custom-property-value-line"><span>Default</span><PropertyInput property={property} value={property.defaultValue} onChange={defaultValue => update(property.id, { defaultValue })} /></div>}
          <ThisSundayToggle property={property} onChange={includeInThisSunday => update(property.id, { includeInThisSunday })} />
        </div>;
      })}
      <AddPropertyControls onAdd={valueType => { const id = `property-${randomId()}`; setFocusPropertyId(id); onChange({ ...template, status: 'draft', customProperties: [...properties, { id, name: `Property ${properties.length + 1}`, valueType, defaultValue: defaultValueForCustomProperty(valueType) }] }); }} />
    </div>
  </details>;
}

export function PageTemplatePropertiesPanel({ pageTemplate, onChange }: { pageTemplate: PageTemplateV1; onChange(pageTemplate: PageTemplateV1): void }) {
  const properties = pageTemplate.customProperties ?? [];
  const [focusPropertyId, setFocusPropertyId] = useState<string>();
  const update = (id: string, changes: Partial<CustomPropertyDefinition>) => onChange({ ...pageTemplate, status: 'draft', customProperties: properties.map(property => property.id === id ? { ...property, ...changes } : property) });
  return <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup custom-properties-panel">
    <summary><div><div className="eyebrow">Page template</div><b>Properties</b></div></summary>
    <div className="collapsible-editor-fields custom-properties-list">
      {properties.map(property => {
        const usages = customPropertyUsages(pageTemplate.blocks, property.id);
        return <div className="custom-property-row" key={property.id}>
          <div className="custom-property-definition-line"><label><span>Name</span><input autoFocus={property.id === focusPropertyId} value={property.name} onFocus={event => { if (property.id === focusPropertyId) { event.currentTarget.select(); setFocusPropertyId(undefined); } }} onChange={event => update(property.id, { name: event.target.value })} /></label>{property.valueType === 'boolean' && <PropertyInput property={property} value={property.defaultValue} onChange={defaultValue => update(property.id, { defaultValue })} />}<button className="property-delete-button" aria-label={`Delete ${property.name}`} disabled={usages.length > 0} title={usages.length ? `Used by ${usages.map(item => item.label).join(', ')}` : 'Delete property'} onClick={() => onChange({ ...pageTemplate, status: 'draft', customProperties: properties.filter(item => item.id !== property.id) })}><TrashIcon /></button></div>
          {property.valueType !== 'boolean' && <div className="custom-property-value-line"><span>Default</span><PropertyInput property={property} value={property.defaultValue} onChange={defaultValue => update(property.id, { defaultValue })} /></div>}
          <ThisSundayToggle property={property} onChange={includeInThisSunday => update(property.id, { includeInThisSunday })} />
        </div>;
      })}
      <AddPropertyControls onAdd={valueType => { const id = `property-${randomId()}`; setFocusPropertyId(id); onChange({ ...pageTemplate, status: 'draft', customProperties: [...properties, { id, name: `Property ${properties.length + 1}`, valueType, defaultValue: defaultValueForCustomProperty(valueType) }] }); }} />
    </div>
  </details>;
}

export function WeeklyPropertiesPanel({ document, template, onChange }: { document: BulletinDocumentV1; template: TemplateV1; onChange(document: BulletinDocumentV1): void }) {
  const properties = effectiveCustomPropertyDefinitions(template, document);
  const [focusPropertyId, setFocusPropertyId] = useState<string>();
  const writeProperties = (next: CustomPropertyDefinition[], overrides = document.customPropertyOverrides) => onChange({
    ...document,
    customProperties: next,
    customPropertyOverrides: overrides,
    blocks: synchronizeCustomPropertyBindings(document.blocks, next),
  });
  const updateDefinition = (id: string, changes: Partial<CustomPropertyDefinition>) => {
    const next = properties.map(property => property.id === id ? { ...property, ...changes } : property);
    writeProperties(next);
  };
  const setValue = (property: CustomPropertyDefinition, value: CustomPropertyValue) => onChange({ ...document, customPropertyOverrides: { ...document.customPropertyOverrides, [property.id]: value } });
  const reset = (propertyId: string) => {
    const overrides = { ...document.customPropertyOverrides };
    delete overrides[propertyId];
    onChange({ ...document, customPropertyOverrides: Object.keys(overrides).length ? overrides : undefined });
  };
  return <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup custom-properties-panel">
    <summary><div><div className="eyebrow">Bulletin</div><b>Properties</b></div></summary>
    <div className="collapsible-editor-fields custom-properties-list">{properties.map(property => {
      const usages = customPropertyUsages(document.blocks, property.id);
      const overridden = Object.prototype.hasOwnProperty.call(document.customPropertyOverrides ?? {}, property.id);
      return <div className="custom-property-row" key={property.id}>
        <div className="custom-property-definition-line"><label><span>Name</span><input autoFocus={property.id === focusPropertyId} value={property.name} onFocus={event => { if (property.id === focusPropertyId) { event.currentTarget.select(); setFocusPropertyId(undefined); } }} onChange={event => updateDefinition(property.id, { name: event.target.value })} /></label>{property.valueType === 'boolean' && <>{overridden && <button className="property-reset-button" onClick={() => reset(property.id)}>Reset</button>}<PropertyInput property={property} value={effectiveCustomPropertyValue(property.id, template, document) ?? property.defaultValue} onChange={value => setValue(property, value)} /></>}<button className="property-delete-button" aria-label={`Delete ${property.name}`} disabled={usages.length > 0} title={usages.length ? `Used by ${usages.map(item => item.label).join(', ')}` : 'Delete property'} onClick={() => {
          const overrides = { ...document.customPropertyOverrides };
          delete overrides[property.id];
          writeProperties(properties.filter(item => item.id !== property.id), Object.keys(overrides).length ? overrides : undefined);
        }}><TrashIcon /></button></div>
        {property.valueType !== 'boolean' && <div className={`custom-property-value-line ${overridden ? 'has-reset' : ''}`}><span>Value</span><PropertyInput property={property} value={effectiveCustomPropertyValue(property.id, template, document) ?? property.defaultValue} onChange={value => setValue(property, value)} />{overridden && <button className="property-reset-button" onClick={() => reset(property.id)}>Reset</button>}</div>}
        <ThisSundayToggle property={property} onChange={includeInThisSunday => updateDefinition(property.id, { includeInThisSunday })} />
      </div>;
    })}
      <AddPropertyControls onAdd={valueType => { const id = `property-${randomId()}`; setFocusPropertyId(id); writeProperties([...properties, { id, name: `Property ${properties.length + 1}`, valueType, defaultValue: defaultValueForCustomProperty(valueType) }]); }} />
    </div>
  </details>;
}

export function ThisSundayProperties({ document, template, onChange }: { document: BulletinDocumentV1; template: TemplateV1; onChange(document: BulletinDocumentV1): void }) {
  const properties = effectiveCustomPropertyDefinitions(template, document).filter(property => property.includeInThisSunday);
  if (!properties.length) return null;
  const setValue = (property: CustomPropertyDefinition, value: CustomPropertyValue) => onChange({ ...document, customPropertyOverrides: { ...document.customPropertyOverrides, [property.id]: value } });
  return <div className="this-sunday-properties">{properties.map(property => {
    const value = effectiveCustomPropertyValue(property.id, template, document) ?? property.defaultValue;
    return property.valueType === 'boolean'
      ? <div className="this-sunday-property-toggle" key={property.id}><span>{property.name}</span><PropertyInput property={property} value={value} onChange={next => setValue(property, next)} /></div>
      : <label key={property.id}>{property.name}<PropertyInput property={property} value={value} onChange={next => setValue(property, next)} /></label>;
  })}</div>;
}
