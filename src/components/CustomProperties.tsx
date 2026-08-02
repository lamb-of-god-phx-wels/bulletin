import type { BulletinDocumentV1, CanvasTextBinding, CustomPropertyDefinition, CustomPropertyValue, TemplateV1 } from '../shared/types';
import { builtInTextBindings, customPropertyBinding, customPropertyUsages, defaultValueForCustomProperty, effectiveCustomPropertyDefinitions, effectiveCustomPropertyValue, isCustomPropertyBinding, synchronizeCustomPropertyBindings } from '../shared/customProperties';
import { randomId } from '../shared/id';

const encodedBinding = (binding: CanvasTextBinding | undefined) => !binding ? '' : isCustomPropertyBinding(binding) ? `custom:${binding.propertyId}` : `builtin:${binding}`;

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
    {(template.customProperties ?? []).filter(property => !booleanOnly || property.valueType === 'boolean').map(property => <option value={`custom:${property.id}`} key={property.id}>{property.name}{booleanOnly ? '' : ` · ${property.valueType}`}</option>)}
  </select>;
}

function PropertyInput({ property, value, onChange }: { property: CustomPropertyDefinition; value: CustomPropertyValue; onChange(value: CustomPropertyValue): void }) {
  if (property.valueType === 'boolean') {
    const checked = Boolean(value);
    return <button type="button" role="switch" aria-label={`${property.name} value`} aria-checked={checked} className="property-toggle" onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
  }
  if (property.valueType === 'number') return <input type="number" value={typeof value === 'number' ? value : 0} onChange={event => Number.isFinite(event.currentTarget.valueAsNumber) && onChange(event.currentTarget.valueAsNumber)} />;
  return <input value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} />;
}

export function TemplatePropertiesPanel({ template, onChange }: { template: TemplateV1; onChange(template: TemplateV1): void }) {
  const properties = template.customProperties ?? [];
  const update = (id: string, changes: Partial<CustomPropertyDefinition>) => onChange({ ...template, status: 'draft', customProperties: properties.map(property => property.id === id ? { ...property, ...changes } : property) });
  return <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup custom-properties-panel">
    <summary><div><div className="eyebrow">Template</div><b>Properties</b></div></summary>
    <div className="collapsible-editor-fields custom-properties-list">
      {properties.map(property => {
        const usages = customPropertyUsages(template.starterBlocks, property.id);
        return <div className="custom-property-row" key={property.id}>
          <label>Name<input value={property.name} onChange={event => update(property.id, { name: event.target.value })} /></label>
          <label>Type<select value={property.valueType} onChange={event => { const valueType = event.target.value as CustomPropertyDefinition['valueType']; update(property.id, { valueType, defaultValue: defaultValueForCustomProperty(valueType) }); }}><option value="boolean">Boolean</option><option value="string">String</option><option value="number">Number</option></select></label>
          <label className="custom-property-value">Default<PropertyInput property={property} value={property.defaultValue} onChange={defaultValue => update(property.id, { defaultValue })} /></label>
          <button className="danger-text" disabled={usages.length > 0} title={usages.length ? `Used by ${usages.map(item => item.label).join(', ')}` : 'Delete property'} onClick={() => onChange({ ...template, status: 'draft', customProperties: properties.filter(item => item.id !== property.id) })}>Delete</button>
          {usages.length > 0 && <small className="field-help">Used by {usages.map(item => item.label).join(', ')}</small>}
        </div>;
      })}
      <button className="secondary" onClick={() => onChange({ ...template, status: 'draft', customProperties: [...properties, { id: `property-${randomId()}`, name: `Property ${properties.length + 1}`, valueType: 'boolean', defaultValue: false }] })}>＋ Property</button>
    </div>
  </details>;
}

export function WeeklyPropertiesPanel({ document, template, onChange }: { document: BulletinDocumentV1; template: TemplateV1; onChange(document: BulletinDocumentV1): void }) {
  const properties = effectiveCustomPropertyDefinitions(template, document);
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
      return <div className="custom-property-row" key={property.id}>
        <label>Name<input value={property.name} onChange={event => updateDefinition(property.id, { name: event.target.value })} /></label>
        <label>Type<select value={property.valueType} onChange={event => {
          const valueType = event.target.value as CustomPropertyDefinition['valueType'];
          const defaultValue = defaultValueForCustomProperty(valueType);
          const overrides = { ...document.customPropertyOverrides, [property.id]: defaultValue };
          const next = properties.map(item => item.id === property.id ? { ...item, valueType, defaultValue } : item);
          writeProperties(next, overrides);
        }}><option value="boolean">Boolean</option><option value="string">String</option><option value="number">Number</option></select></label>
        <label className="custom-property-value">Value<PropertyInput property={property} value={effectiveCustomPropertyValue(property.id, template, document) ?? property.defaultValue} onChange={value => setValue(property, value)} /></label>
        <button className="text-button" disabled={!Object.prototype.hasOwnProperty.call(document.customPropertyOverrides ?? {}, property.id)} onClick={() => reset(property.id)}>Reset value</button>
        <button className="danger-text" disabled={usages.length > 0} title={usages.length ? `Used by ${usages.map(item => item.label).join(', ')}` : 'Delete property'} onClick={() => {
          const overrides = { ...document.customPropertyOverrides };
          delete overrides[property.id];
          writeProperties(properties.filter(item => item.id !== property.id), Object.keys(overrides).length ? overrides : undefined);
        }}>Delete</button>
        {usages.length > 0 && <small className="field-help">Used by {usages.map(item => item.label).join(', ')}</small>}
      </div>;
    })}
      <button className="secondary" onClick={() => writeProperties([...properties, { id: `property-${randomId()}`, name: `Property ${properties.length + 1}`, valueType: 'boolean', defaultValue: false }])}>＋ Property</button>
    </div>
  </details>;
}
