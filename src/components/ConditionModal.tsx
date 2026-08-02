import { useState } from 'react';
import type { ElementCondition, TemplateV1 } from '../shared/types';
import { customPropertyBinding } from '../shared/customProperties';
import { CustomPropertyBindingSelect } from './CustomProperties';

export function ConditionModal({ value, template, onSave, onClose }: {
  value?: ElementCondition;
  template: TemplateV1;
  onSave(value?: ElementCondition): void;
  onClose(): void;
}) {
  const firstBoolean = template.customProperties?.find(property => property.valueType === 'boolean');
  const [property, setProperty] = useState(value?.property ?? (firstBoolean ? customPropertyBinding(firstBoolean) : undefined));
  const [equals, setEquals] = useState(value?.equals ?? true);
  return <div className="modal-backdrop condition-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="condition-modal" role="dialog" aria-modal="true" aria-labelledby="condition-modal-title">
      <header><div><div className="eyebrow">Element visibility</div><h2 id="condition-modal-title">Conditional showing</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
      <div className="condition-modal-fields">
        {firstBoolean || value ? <>
          <label>Toggle property<CustomPropertyBindingSelect value={property} template={template} booleanOnly onChange={next => setProperty(next && typeof next !== 'string' ? next : undefined)} /></label>
          <label>Show this element when<select value={String(equals)} onChange={event => setEquals(event.target.value === 'true')}><option value="true">On</option><option value="false">Off</option></select></label>
        </> : <p className="helper">Add a Toggle property before setting a condition.</p>}
      </div>
      <footer>{value ? <button className="danger-text" onClick={() => onSave(undefined)}>Remove condition</button> : <span />}<div><button onClick={onClose}>Cancel</button><button className="primary" disabled={!property} onClick={() => property && onSave({ property, equals })}>Apply</button></div></footer>
    </section>
  </div>;
}
