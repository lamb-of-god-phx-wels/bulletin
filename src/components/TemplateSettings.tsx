import { useState } from "react";
import type { LibraryManifestV1, TemplateV1 } from "../shared/types";
import { effectiveFontRoles, familyLabel, remapFontRole } from "../shared/fonts";
import { defaultResponsiveReadingSettings, effectiveResponsiveReadingSettings, updateResponsiveReaderLabels } from "../shared/responsiveReading";
import { FontPicker } from "./FontPicker";
import { ResponsiveReadingSettingsFields } from "./ResponsiveReadingSettingsFields";
import { TemplatePropertiesPanel } from "./CustomProperties";

export function TemplateSettings({ template, library, onChange }: {
  template: TemplateV1;
  library?: LibraryManifestV1;
  onChange(template: TemplateV1): void;
}) {
  const roles = effectiveFontRoles(template.theme, library);
  const [replacingRoleId, setReplacingRoleId] = useState<string>();
  const update = (changes: Partial<TemplateV1>) => onChange({ ...template, ...changes, status: "draft" });
  const updateTheme = (changes: Partial<TemplateV1["theme"]>, starterBlocks = template.starterBlocks) => update({
    theme: { ...template.theme, ...changes },
    starterBlocks,
  });
  const updateRoles = (nextRoles: typeof roles, starterBlocks = template.starterBlocks) => updateTheme({
    fontRoles: nextRoles,
    defaultFontRoleId: "body",
    bodyFont: familyLabel(nextRoles.find(role => role.id === "body")?.family ?? roles[0].family, library),
    displayFont: familyLabel(nextRoles.find(role => role.id === "display")?.family ?? nextRoles.find(role => role.id === "body")!.family, library),
  }, starterBlocks);
  const readingSettings = effectiveResponsiveReadingSettings(template);

  return <>
    <section className="editor-card properties-section">
      <header className="properties-section-heading"><div className="eyebrow">Template</div><h3>Theme</h3></header>
      <div className="properties-section-body">
        <div className="theme-font-roles">
          <header><div><b>Font roles</b><small>Change a family once for every element using that role.</small></div><button type="button" className="secondary" onClick={() => {
            let id = "font";
            for (let suffix = 2; roles.some(role => role.id === id); suffix++) id = `font-${suffix}`;
            updateRoles([...roles, { id, name: "New font role", family: roles.find(role => role.id === "body")!.family }]);
          }}>＋ Add role</button></header>
          {roles.map(role => <div className="theme-font-role" key={role.id}>
            <label>Role name<input value={role.name} disabled={role.id === "body"} onChange={event => updateRoles(roles.map(candidate => candidate.id === role.id ? { ...candidate, name: event.target.value } : candidate))} /></label>
            <FontPicker label={`${role.name} family`} familiesOnly fontRef={{ kind: "libraryFont", family: role.family }} onChange={fontRef => {
              if (fontRef.kind === "libraryFont") updateRoles(roles.map(candidate => candidate.id === role.id ? { ...candidate, family: fontRef.family } : candidate));
            }} />
            {role.id === "body" ? <span className="role-required">Required</span> : <button type="button" className="danger-text" onClick={() => setReplacingRoleId(role.id)}>Delete</button>}
          </div>)}
          {replacingRoleId && <div className="font-role-replacement">
            <label>Replace “{roles.find(role => role.id === replacingRoleId)?.name}” with<select id="template-font-role-replacement" defaultValue="body">{roles.filter(role => role.id !== replacingRoleId).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
            <div><button type="button" className="secondary" onClick={() => setReplacingRoleId(undefined)}>Cancel</button><button type="button" className="primary" onClick={() => {
              const replacement = (document.getElementById("template-font-role-replacement") as HTMLSelectElement | null)?.value ?? "body";
              updateRoles(roles.filter(role => role.id !== replacingRoleId), remapFontRole(template.starterBlocks, replacingRoleId, replacement));
              setReplacingRoleId(undefined);
            }}>Replace and delete</button></div>
          </div>}
        </div>
        <div className="field-row">
          <label>Accent<input type="color" value={template.theme.accent} onChange={event => updateTheme({ accent: event.target.value })} /></label>
          <label>Body size (points)<input type="number" min="8" max="14" step="0.5" value={template.theme.bodySizePt} onChange={event => Number.isFinite(event.currentTarget.valueAsNumber) && updateTheme({ bodySizePt: event.currentTarget.valueAsNumber })} /></label>
        </div>
      </div>
    </section>
    <section className="editor-card properties-section">
      <header className="properties-section-heading"><div className="eyebrow">Template</div><h3>Page setup</h3></header>
      <div className="properties-section-body">
        <p className="helper">Physical page: {template.page.widthIn} × {template.page.heightIn} inches. These defaults apply to new bulletins.</p>
        <label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={template.theme.marginIn} onChange={event => Number.isFinite(event.currentTarget.valueAsNumber) && updateTheme({ marginIn: Math.max(0, Math.min(1.25, event.currentTarget.valueAsNumber)) })} /></label>
      </div>
    </section>
    <section className="editor-card properties-section">
      <header className="properties-section-heading"><div className="eyebrow">Template</div><h3>Responsive readings</h3></header>
      <div className="properties-section-body"><ResponsiveReadingSettingsFields value={readingSettings} onChange={next => update({ responsiveReading: next, starterBlocks: updateResponsiveReaderLabels(template.starterBlocks, readingSettings, next) })} /><button type="button" className="text-button" onClick={() => update({ responsiveReading: defaultResponsiveReadingSettings, starterBlocks: updateResponsiveReaderLabels(template.starterBlocks, readingSettings, defaultResponsiveReadingSettings) })}>Reset labels</button></div>
    </section>
    <TemplatePropertiesPanel template={template} onChange={onChange} />
  </>;
}
