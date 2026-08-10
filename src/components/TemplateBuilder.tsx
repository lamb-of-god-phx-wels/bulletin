import { useState } from "react";
import { BlockLibraryModal } from "./BlockLibraryModal";
import { BlockFormattingModal } from "./BlockFormattingModal";
import { customBlockIssues } from "../shared/customBlocks";
import { instantiateComponentDefinition } from "../componentDefinitions";
import { childBlocks, createLayoutContainer, createTableCell, findBlock, groupAcceptsChild, groupChildCell, moveGroupChildToCell, moveGroupChildToRoot, placeGroupChild, updateBlockTree, type LayoutCell } from "../shared/blocks";
import type { DeclarativeComponentDefinition } from "../component-engine/types";
import type {
  BulletinBlock,
  LibraryManifestV1,
  PageTemplateV1,
  TemplateV1,
} from "../shared/types";
import { CanvasDesigner } from "./CanvasDesigner";
import { createBulletin } from "../shared/defaults";
import { SortableHandle, SortableItem, SortableList } from "./SortableList";
import {
  explodeTemplatePage,
  instantiatePageTemplate,
  pageTemplateDigest,
  pageTemplateVersions,
} from "../shared/pageTemplates";
import { PageTemplateEditor } from "./PageTemplateEditor";
import { ElementPalette, ElementSidebarPortal, type ElementPaletteItem } from "./ElementPalette";
import { PageElementDialog } from "./PageElementDialog";
import { SongBlockFields } from "./SongBlockFields";
import { flowElementPaletteItems, type ElementPalettePayload } from "./elementPaletteCatalog";
import { FontPicker } from "./FontPicker";
import { randomId } from "../shared/id";
import { ImageAssetDialog } from "./ImageAssetDialog";
import { ImageBlockFields } from "./ImageBlockFields";
import { AnnouncementFields } from "./AnnouncementFields";
import { ListFields } from "./ListFields";
import { CopyrightFields } from "./CopyrightFields";
import { ResponsiveReadingFields } from "./ResponsiveReadingFields";
import { ResponsiveReadingSettingsFields } from "./ResponsiveReadingSettingsFields";
import type { UndoRedoCommands } from "./useUndoRedo";
import { defaultResponsiveReadingSettings, effectiveResponsiveReadingSettings, updateResponsiveReaderLabels } from "../shared/responsiveReading";
import { RichTextEditor } from "./RichTextEditor";
import { TemplatePropertiesPanel } from "./CustomProperties";
import { customPropertyIssues } from "../shared/customProperties";
import { ConditionModal } from "./ConditionModal";
import { blockDisplayName } from "../shared/blockNames";
import { EditableElementName } from "./EditableElementName";
import { TemplateElementDialog } from "./TemplateElementDialog";
import { explodeTemplateInstance, instantiateTemplate, templateVersions } from "../shared/templates";
import { RichTextBindingControl } from "./RichTextBindingControl";
import { boundRichTextParagraphs } from "../shared/canvas";
import { ElementPickerDialog } from "./ElementPickerDialog";
import { LayoutContainerFields } from "./LayoutContainerFields";
import { effectiveFontRoles, familyLabel, remapFontRole } from "../shared/fonts";

export function TemplateBuilder({
  template,
  templates,
  pageTemplates,
  workspaceDefinitions,
  library,
  root,
  onChange,
  history,
  onDefinitionsChange,
  onLibraryChange,
  onSave,
  onDeleteVersion,
  onDeleteTemplate,
  canDeleteVersion,
  canDeleteTemplate,
}: {
  template: TemplateV1;
  templates: TemplateV1[];
  pageTemplates: PageTemplateV1[];
  workspaceDefinitions: DeclarativeComponentDefinition[];
  library?: LibraryManifestV1;
  root?: string;
  onChange(value: TemplateV1): void;
  history: UndoRedoCommands;
  onDefinitionsChange(value: DeclarativeComponentDefinition[]): Promise<void>;
  onLibraryChange(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onSave(publish: boolean): Promise<void>;
  onDeleteVersion(): void;
  onDeleteTemplate(): void;
  canDeleteVersion: boolean;
  canDeleteTemplate: boolean;
}) {
  const fontRoles = effectiveFontRoles(template.theme, library);
  const [replacingFontRoleId, setReplacingFontRoleId] = useState<string>();
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false);
  const [pageInsertionIndex, setPageInsertionIndex] = useState<number>();
  const [templateInsertionIndex, setTemplateInsertionIndex] = useState<number>();
  const [creatingPage, setCreatingPage] = useState<PageTemplateV1>();
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const [editingBlockIds, setEditingBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [canvasBlockId, setCanvasBlockId] = useState<string>();
  const [templatePageBlockId, setTemplatePageBlockId] = useState<string>();
  const [imageIndex, setImageIndex] = useState<number>();
  const [elementParentId, setElementParentId] = useState<string>();
  const [elementCell, setElementCell] = useState<LayoutCell>();
  const [childImageTarget, setChildImageTarget] = useState<{ parentId: string; cell?: LayoutCell }>();
  const [conditionBlockId, setConditionBlockId] = useState<string>();
  const toggleEditor = (id: string) =>
    setEditingBlockIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const updateTemplate = (changes: Partial<TemplateV1>) =>
    onChange({ ...template, ...changes, status: "draft" });
  const blockTitle = blockDisplayName;
  const updateTheme = (
    key: keyof TemplateV1["theme"],
    value: string | number,
  ) => updateTemplate({ theme: { ...template.theme, [key]: value } });
  const updateFontRoles = (roles: typeof fontRoles, starterBlocks = template.starterBlocks) => updateTemplate({
    theme: {
      ...template.theme,
      fontRoles: roles,
      defaultFontRoleId: 'body',
      bodyFont: familyLabel(roles.find(role => role.id === 'body')?.family ?? fontRoles[0].family, library),
      displayFont: familyLabel(roles.find(role => role.id === 'display')?.family ?? roles.find(role => role.id === 'body')!.family, library),
    },
    starterBlocks,
  });
  const responsiveReadingSettings = effectiveResponsiveReadingSettings(template);
  const updateResponsiveReadingSettings = (next: typeof responsiveReadingSettings) => updateTemplate({
    responsiveReading: next,
    starterBlocks: updateResponsiveReaderLabels(template.starterBlocks, responsiveReadingSettings, next),
  });
  const addBlock = (block: BulletinBlock, index = template.starterBlocks.length) => {
    updateTemplate({ starterBlocks: [...template.starterBlocks.slice(0, index), block, ...template.starterBlocks.slice(index)] });
    setBlockLibraryOpen(false);
  };
  const addChildBlock = (parentId: string, child: BulletinBlock, cell?: LayoutCell) => {
    const parent = findBlock(template.starterBlocks, parentId);
    if (parent?.type !== 'group' || !groupAcceptsChild(parent, child)) return;
    updateTemplate({ starterBlocks: updateBlockTree(template.starterBlocks, parent.id, placeGroupChild(parent, child, cell)) });
  };
  const insertChildPaletteItem = (item: ElementPaletteItem, parentId: string, cell?: LayoutCell) => {
    const payload = item.payload as ElementPalettePayload;
    const parent = findBlock(template.starterBlocks, parentId);
    if (parent?.type !== 'group') return false;
    if (parent.layoutMode === 'table') return true;
    if (payload.kind === 'component') {
      const child = instantiateComponentDefinition(payload.definition);
      if (!groupAcceptsChild(parent, child)) return true;
      addChildBlock(parentId, child, cell);
    }
    else if (payload.kind === 'container') addChildBlock(parentId, createLayoutContainer(payload.layoutMode, `container-${randomId()}`), cell);
    else if (payload.kind === 'image') setChildImageTarget({ parentId, cell });
    else return false;
    return true;
  };
  const useChildPaletteItem = (item: ElementPaletteItem) => {
    if (!elementParentId) return;
    insertChildPaletteItem(item, elementParentId, elementCell);
    setElementParentId(undefined);
    setElementCell(undefined);
  };
  const moveBlockIntoContainer = (blockId: string, containerId: string, cell?: LayoutCell) => {
    const child = template.starterBlocks.find(block => block.id === blockId);
    const parent = findBlock(template.starterBlocks, containerId);
    if (!child || parent?.type !== 'group' || findBlock([child], containerId)) return false;
    if (parent.layoutMode === 'table') return true;
    if (!groupAcceptsChild(parent, child)) return true;
    const remaining = template.starterBlocks.filter(block => block.id !== child.id);
    updateTemplate({ starterBlocks: updateBlockTree(remaining, parent.id, placeGroupChild(parent, child, cell)) });
    return true;
  };
  const usePaletteItem = async (item: ElementPaletteItem, index: number) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === "component") addBlock(instantiateComponentDefinition(payload.definition), index);
    else if (payload.kind === "container") addBlock(createLayoutContainer(payload.layoutMode, `container-${randomId()}`), index);
    else if (payload.kind === "page") setPageInsertionIndex(index);
    else if (payload.kind === "template") setTemplateInsertionIndex(index);
    else if (payload.kind === "image") setImageIndex(index);
    else if (payload.kind === "fullPageAsset" && root && window.bulletin) {
      const asset = await window.bulletin.importAsset(root, `assets/templates/${template.id}`);
      if (!asset) return;
      addBlock({ id: `page-${randomId()}`, type: "fullPageAsset", asset }, index);
    }
  };
  const updateBlock = (id: string, changes: Partial<BulletinBlock>) => {
    const block = findBlock(template.starterBlocks, id);
    if (block)
      updateTemplate({
        starterBlocks: updateBlockTree(template.starterBlocks, id, {
          ...block,
          ...changes,
        } as BulletinBlock),
      });
  };
  const blockOptions = (block: BulletinBlock) =>
    block.type === "richText" ? (
      <div className="outline-options"><RichTextBindingControl value={block.binding} template={template} library={library} root={root} onChange={binding => updateBlock(block.id, { binding, bindingOverride: undefined })} /></div>
    ) : block.type === "scriptureReading" ? (
      <div className="outline-options">
        <label className="outline-option">
          Heading and reference
          <select
            value={block.headingReferenceLayout ?? "inline"}
            onChange={(event) =>
              updateBlock(block.id, {
                headingReferenceLayout: event.target.value as
                  "inline" | "stacked",
              })
            }
          >
            <option value="inline">Same line</option>
            <option value="stacked">Stacked</option>
          </select>
        </label>
        <label className="outline-option">
          Space (inches)
          <input
            type="number"
            min="0"
            max="2"
            step="0.01"
            disabled={(block.headingReferenceLayout ?? "inline") !== "inline"}
            value={block.headingReferenceGapIn ?? 0.12}
            onChange={(event) => {
              if (Number.isFinite(event.currentTarget.valueAsNumber))
                updateBlock(block.id, {
                  headingReferenceGapIn: Math.max(
                    0,
                    event.currentTarget.valueAsNumber,
                  ),
                });
            }}
          />
        </label>
      </div>
    ) : block.type === "group" ? (
      <div className="outline-options container-options">
        <LayoutContainerFields block={block} onChange={next => updateBlock(block.id, next)} onAdd={cell => { setElementParentId(block.id); setElementCell(cell); }} />
      </div>
    ) : block.type === "song" ? (
      <SongBlockFields
        block={block}
        library={library}
        template={template}
        scope="template"
        root={root}
        onChange={next => updateBlock(block.id, next)}
      />
    ) : block.type === "announcements" ? (
      <AnnouncementFields block={block} library={library} root={root} targetFolder={`assets/templates/${template.id}/announcements`} onLibraryChange={onLibraryChange} onError={message => setSaveStatus(message)} onChange={next => updateBlock(block.id, next)} />
    ) : block.type === "list" ? (
      <ListFields block={block} library={library} root={root} targetFolder={`assets/templates/${template.id}/lists`} onLibraryChange={onLibraryChange} onError={message => setSaveStatus(message)} onChange={next => updateBlock(block.id, next)} />
    ) : block.type === "copyright" ? (
      <CopyrightFields block={block} onChange={next => updateBlock(block.id, next)} />
    ) : block.type === "responsiveReading" ? (
      <ResponsiveReadingFields block={block} settings={responsiveReadingSettings} template={template} onChange={next => updateBlock(block.id, next)} />
    ) : block.type === "image" ? (
      <ImageBlockFields block={block} library={library} root={root} targetFolder={`assets/templates/${template.id}`} onLibraryChange={onLibraryChange} onChange={next => updateBlock(block.id, next)} onError={message => setSaveStatus(message)} />
    ) : null;
  const nestedOutline = (parent: BulletinBlock): React.ReactNode => {
    if (parent.type === 'templatePage' || (parent.type === 'templateInstance' && !editingBlockIds.has(parent.id))) return null;
    const children = childBlocks(parent);
    if (!children) return null;
    const entries = children.map(child => {
      const entry = <li
            className={childBlocks(child) ? "outline-container" : undefined}
            data-editor-block-id={child.id}
            data-layout-container={child.type === 'group' ? 'true' : undefined}
            tabIndex={-1}
            key={child.id}
          >
            <div className="outline-main">
              <EditableElementName as="b" value={blockTitle(child)} onRename={displayName => updateBlock(child.id, { displayName })} />
              <small>
                {child.type} · Nested element
                {child.presentation ? " · Formatted" : ""}
              </small>
              {child.type === "richText" &&
                !child.scriptureRole &&
                editingBlockIds.has(child.id) && (
                  <RichTextEditor className="outline-text-editor" content={boundRichTextParagraphs(child, createBulletin(template), template, library)} label={`Edit ${blockTitle(child)}`} onChange={content => updateBlock(child.id, child.binding ? { bindingOverride: content } : { content })} />
                )}
              {blockOptions(child)}
            </div>
            <div className="reorder">
              <button className={`format-block-button condition-toggle ${child.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(child.condition)} title="Set conditional visibility" onClick={() => setConditionBlockId(child.id)}>Condition</button>
              {child.type === "richText" && !child.scriptureRole && (
                <button
                  className="edit-content-button"
                  aria-expanded={editingBlockIds.has(child.id)}
                  onClick={() => toggleEditor(child.id)}
                >
                  {editingBlockIds.has(child.id) ? "Done" : "Edit"}
                </button>
              )}
              <button
                className="format-block-button"
                onClick={() => setFormattingBlockId(child.id)}
              >
                Format
              </button>
              {parent.type === 'group' && parent.layoutMode !== 'table' && <button className="danger-text" aria-label={`Remove ${blockTitle(child)}`} onClick={() => updateBlock(parent.id, { children: parent.children.filter(item => item.id !== child.id) })}>×</button>}
              {parent.type === 'group' && parent.layoutMode !== 'table' && <SortableHandle label={`Drag ${blockTitle(child)} to move it within ${blockTitle(parent)}`} />}
            </div>
            {nestedOutline(child)}
          </li>;
      return parent.type === 'group' ? <SortableItem id={child.id} key={child.id}>{entry}</SortableItem> : entry;
    });
    if (parent.type !== 'group') return <ol className="nested-outline">{entries}</ol>;
    const grid = (parent.layoutMode ?? 'stack') !== 'stack' ? {
      rows: Math.max(1, parent.rows ?? 2),
      columns: Math.max(1, parent.columns ?? 2),
      containerId: parent.id,
      cells: Object.fromEntries(parent.children.map((child, index) => [child.id, groupChildCell(parent, child, index)])),
      onMove: (id: string, cell: LayoutCell) => updateBlock(parent.id, moveGroupChildToCell(parent, id, cell)),
      onAdd: (cell: LayoutCell) => parent.layoutMode === 'table' ? addChildBlock(parent.id, createTableCell(`text-${randomId()}`), cell) : (setElementParentId(parent.id), setElementCell(cell))
    } : undefined;
    return <div className="nested-outline"><SortableList items={parent.children} onChange={children => updateBlock(parent.id, { children })} grid={grid} onMoveOut={(id, targetId, position) => { updateTemplate({ starterBlocks: moveGroupChildToRoot(template.starterBlocks, parent.id, id, targetId, position) }); return true; }}>{entries}</SortableList></div>;
  };
  const save = async (publish: boolean) => {
    const customIssues = template.starterBlocks.flatMap((block) =>
      block.type === "custom" ? customBlockIssues(block) : [],
    );
    customIssues.push(...customPropertyIssues(template).map(issue => issue.message));
    if (publish && customIssues.length) {
      setSaveStatus(
        `Fix ${customIssues.length} custom block ${customIssues.length === 1 ? "issue" : "issues"} before publishing`,
      );
      return;
    }
    setSaving(true);
    setSaveStatus(publish ? "Publishing…" : "Saving draft…");
    try {
      await onSave(publish);
      setSaveStatus(publish ? "New version published" : "Draft saved");
    } catch {
      setSaveStatus(publish ? "Could not publish" : "Could not save draft");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="builder-layout">
      <div className="builder-panel">
        <div className="eyebrow">Template builder</div>
        <h1>{template.name}</h1>
        <p className="lead">
          Arrange pre-packaged and workspace JSON blocks into a reusable
          service.
        </p>
        <div className="builder-actions">
          <button
            className="secondary"
            disabled={saving}
            onClick={() => save(false)}
          >
            Save draft
          </button>
          <button
            className="primary"
            disabled={saving}
            onClick={() => save(true)}
          >
            Publish new version
          </button>
          <button
            className="danger-text"
            disabled={saving || !canDeleteVersion}
            title={
              canDeleteVersion
                ? "Delete only the selected version"
                : "A workspace must keep at least one template version"
            }
            onClick={() => void onDeleteVersion()}
          >
            Delete version
          </button>
          <button
            className="danger-text"
            disabled={saving || !canDeleteTemplate}
            title={
              canDeleteTemplate
                ? "Delete this template and every version"
                : "A workspace must keep at least one template"
            }
            onClick={() => void onDeleteTemplate()}
          >
            Delete template
          </button>
          {saveStatus && (
            <span
              className="template-save-status"
              role="status"
              aria-live="polite"
            >
              {saveStatus}
            </span>
          )}
        </div>
        <section className="editor-card">
          <h2>Theme</h2>
          <div className="theme-font-roles">
            <header><div><b>Font roles</b><small>Use roles throughout the template so a family can be changed in one place.</small></div><button type="button" className="secondary" onClick={() => {
              const base = 'font'; let id = base; let suffix = 2;
              while (fontRoles.some(role => role.id === id)) id = `${base}-${suffix++}`;
              updateFontRoles([...fontRoles, { id, name: 'New font role', family: fontRoles.find(role => role.id === 'body')!.family }]);
            }}>＋ Add role</button></header>
            {fontRoles.map(role => <div className="theme-font-role" key={role.id}>
              <label>Role name<input value={role.name} disabled={role.id === 'body'} onChange={event => updateFontRoles(fontRoles.map(candidate => candidate.id === role.id ? { ...candidate, name: event.target.value } : candidate))} /></label>
              <FontPicker label={`${role.name} family`} familiesOnly fontRef={{ kind: 'libraryFont', family: role.family }} onChange={fontRef => { if (fontRef.kind === 'libraryFont') updateFontRoles(fontRoles.map(candidate => candidate.id === role.id ? { ...candidate, family: fontRef.family } : candidate)); }} />
              {role.id === 'body' ? <span className="role-required">Required</span> : <button type="button" className="danger-text" onClick={() => setReplacingFontRoleId(role.id)}>Delete</button>}
            </div>)}
            {replacingFontRoleId && <div className="font-role-replacement"><label>Replace “{fontRoles.find(role => role.id === replacingFontRoleId)?.name}” with<select id="font-role-replacement-select" defaultValue="body">{fontRoles.filter(role => role.id !== replacingFontRoleId).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label><div><button type="button" className="secondary" onClick={() => setReplacingFontRoleId(undefined)}>Cancel</button><button type="button" className="primary" onClick={() => {
              const select = document.getElementById('font-role-replacement-select') as HTMLSelectElement | null;
              const replacement = select?.value ?? 'body';
              updateFontRoles(fontRoles.filter(role => role.id !== replacingFontRoleId), remapFontRole(template.starterBlocks, replacingFontRoleId, replacement));
              setReplacingFontRoleId(undefined);
            }}>Replace and delete</button></div></div>}
          </div>
          <div className="field-row">
            <label>
              Accent
              <input
                type="color"
                value={template.theme.accent}
                onChange={(event) => updateTheme("accent", event.target.value)}
              />
            </label>
            <label>
              Body size (points)
              <input
                type="number"
                min="8"
                max="14"
                step="0.5"
                value={template.theme.bodySizePt}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber))
                    updateTheme(
                      "bodySizePt",
                      event.currentTarget.valueAsNumber,
                    );
                }}
              />
            </label>
          </div>
        </section>
        <ElementSidebarPortal><>
        <TemplatePropertiesPanel template={template} onChange={onChange} />
        <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup">
          <summary><div><div className="eyebrow">Document</div><b>Responsive readings</b></div></summary>
          <div className="collapsible-editor-fields">
            <ResponsiveReadingSettingsFields value={responsiveReadingSettings} onChange={updateResponsiveReadingSettings} />
            <button type="button" className="text-button" disabled={!template.responsiveReading} onClick={() => updateResponsiveReadingSettings(defaultResponsiveReadingSettings)}>Reset labels</button>
          </div>
        </details>
        <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup">
          <summary>
            <div>
              <div className="eyebrow">Document</div>
              <b>Page setup</b>
            </div>
          </summary>
          <div className="collapsible-editor-fields">
            <p className="helper">
              Physical page: 7 × 8.5 inches. These defaults apply to every
              bulletin created from this template.
            </p>
            <label>
              Page margin (inches)
              <input
                type="number"
                min="0"
                max="1.25"
                step="0.05"
                value={template.theme.marginIn}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber))
                    updateTheme("marginIn", event.currentTarget.valueAsNumber);
                }}
              />
              <small className="field-help">
                Applies to all four sides. The PDF print dialog should use no
                additional margins.
              </small>
            </label>
          </div>
        </details></></ElementSidebarPortal>
        <section className="editor-card">
          <div className="editor-section-title">
            <div>
              <h2>Starter outline</h2>
              <small>{template.starterBlocks.length} blocks</small>
            </div>
          </div>
          <SortableList
            items={template.starterBlocks}
            onChange={(starterBlocks) => updateTemplate({ starterBlocks })}
            onInsert={(descriptor, index) => void usePaletteItem(descriptor as ElementPaletteItem, index)}
            onInsertInto={(descriptor, containerId, cell) => insertChildPaletteItem(descriptor as ElementPaletteItem, containerId, cell)}
            onMoveInto={moveBlockIntoContainer}
            dockedPalette
            palette={<ElementPalette
              items={flowElementPaletteItems(workspaceDefinitions)}
              portalTargetId="app-element-palette-slot"
              onUse={item => void usePaletteItem(item, template.starterBlocks.length)}
              actions={<button className="text-button" onClick={() => setBlockLibraryOpen(true)}>Manage components…</button>}
            />}
          >
            <ol className="outline">
              {template.starterBlocks.map((block) => (
                <SortableItem id={block.id} key={block.id}>
                  <li
                    className={
                      childBlocks(block) ? "outline-container" : undefined
                    }
                    data-editor-block-id={block.id}
                    data-sortable-root-item="true"
                    data-layout-container={block.type === 'group' ? 'true' : undefined}
                    tabIndex={-1}
                  >
                    <div className="outline-main">
                      <EditableElementName as="b" value={blockTitle(block)} onRename={displayName => updateBlock(block.id, { displayName })} />
                      <small>
                        {block.type === "custom" ? "Church block" : block.type}
                        {block.presentation ? " · Formatted" : ""}
                      </small>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={block.weeklyEditable ?? false}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              weeklyEditable: event.target.checked,
                            })
                          }
                        />
                        Editable each week
                      </label>
                      {blockOptions(block)}
                    </div>
                    <div className="reorder">
                      <button className={`format-block-button condition-toggle ${block.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(block.condition)} title="Set conditional visibility" onClick={() => setConditionBlockId(block.id)}>Condition</button>
                      {block.type === "canvas" ? (
                        <button
                          className="format-block-button"
                          title="Design canvas"
                          onClick={() => setCanvasBlockId(block.id)}
                        >
                          Design
                        </button>
                      ) : block.type === "templatePage" ? (
                        <>
                          <button
                            className="format-block-button"
                            onClick={() => setTemplatePageBlockId(block.id)}
                          >
                            Edit page
                          </button>
                          <button
                            className="format-block-button"
                            onClick={() => {
                              const source = pageTemplates.find(
                                (page) =>
                                  page.id === block.source.id &&
                                  page.version === block.source.version,
                              );
                              if (source)
                                updateBlock(
                                  block.id,
                                  instantiatePageTemplate(source, block.id, template),
                                );
                            }}
                          >
                            Reset
                          </button>
                          <button
                            className="format-block-button"
                            onClick={() => {
                              const latest = pageTemplateVersions(
                                pageTemplates.map((pageTemplate) => ({
                                  path: "",
                                  pageTemplate,
                                })),
                                block.source.id,
                              ).find(
                                (record) =>
                                  record.pageTemplate.status === "published",
                              )?.pageTemplate;
                              if (
                                latest &&
                                latest.version !== block.source.version &&
                                window.confirm(
                                  `Replace local changes with ${latest.name} v${latest.version}?`,
                                )
                              )
                                updateBlock(
                                  block.id,
                                  instantiatePageTemplate(latest, block.id, template),
                                );
                            }}
                          >
                            Upgrade
                          </button>
                          <button
                            className="format-block-button"
                            onClick={() =>
                              updateTemplate({
                                starterBlocks: explodeTemplatePage(
                                  template.starterBlocks,
                                  block.id,
                                ),
                              })
                            }
                          >
                            Explode
                          </button>
                        </>
                      ) : block.type === "templateInstance" ? (
                        <>
                          <button className="format-block-button" onClick={() => toggleEditor(block.id)}>
                            {editingBlockIds.has(block.id) ? "Done" : "Edit contents"}
                          </button>
                          <button className="format-block-button" onClick={() => {
                            const source = templates.find(item => item.id === block.source.id && item.version === block.source.version && item.status === "published");
                            if (source) updateBlock(block.id, { ...instantiateTemplate(source, block.id, template, template.starterBlocks.filter(item => item.id !== block.id)), condition: block.condition, displayName: block.displayName });
                          }}>Reset</button>
                          <button className="format-block-button" onClick={() => {
                            const latest = templateVersions(templates.map(item => ({ path: "", template: item })), block.source.id).find(item => item.template.status === "published")?.template;
                            if (latest && latest.version !== block.source.version && window.confirm(`Replace local changes with ${latest.name} v${latest.version}?`))
                              updateBlock(block.id, { ...instantiateTemplate(latest, block.id, template, template.starterBlocks.filter(item => item.id !== block.id)), condition: block.condition, displayName: block.displayName });
                          }}>Upgrade</button>
                          <button className="format-block-button" onClick={() => updateTemplate({ starterBlocks: explodeTemplateInstance(template.starterBlocks, block.id) })}>Explode</button>
                        </>
                      ) : (
                        <button
                          className="format-block-button"
                          title="Format block"
                          onClick={() => setFormattingBlockId(block.id)}
                        >
                          Format
                        </button>
                      )}
                      <button
                        className="danger-text"
                        title="Remove block"
                        onClick={() =>
                          updateTemplate({
                            starterBlocks: template.starterBlocks.filter(
                              (item) => item.id !== block.id,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                      <SortableHandle
                        label={`Drag ${blockTitle(block)} to reorder`}
                      />
                    </div>
                    {nestedOutline(block)}
                  </li>
                </SortableItem>
              ))}
            </ol>
          </SortableList>
        </section>
      </div>
      {pageInsertionIndex !== undefined && !creatingPage && (
        <PageElementDialog
          pages={pageTemplates}
          library={library}
          root={root}
          onClose={() => setPageInsertionIndex(undefined)}
          onSelect={page => { addBlock(instantiatePageTemplate(page, randomId(), template), pageInsertionIndex); setPageInsertionIndex(undefined); }}
          onCreate={setCreatingPage}
        />
      )}
      {templateInsertionIndex !== undefined && (
        <TemplateElementDialog
          templates={templates}
          library={library}
          root={root}
          excludeTemplateId={template.id}
          onClose={() => setTemplateInsertionIndex(undefined)}
          onSelect={source => {
            addBlock(instantiateTemplate(source, randomId(), template, template.starterBlocks), templateInsertionIndex);
            setTemplateInsertionIndex(undefined);
          }}
        />
      )}
      {creatingPage && (
        <PageTemplateEditor
          value={creatingPage}
          template={template}
          library={library}
          root={root}
          definitions={workspaceDefinitions}
          onLibraryChange={onLibraryChange}
          onError={message => setSaveStatus(message)}
          onChange={setCreatingPage}
          onSave={async publish => {
            if (!root || !window.bulletin) throw new Error("A workspace is required to save reusable pages.");
            const saved = { ...creatingPage, status: publish ? "published" as const : "draft" as const, updatedAt: new Date().toISOString() };
            await window.bulletin.savePageTemplate(root, saved);
            setCreatingPage(saved);
            if (publish && pageInsertionIndex !== undefined) {
              addBlock(instantiatePageTemplate(saved, randomId(), template), pageInsertionIndex);
              setCreatingPage(undefined);
              setPageInsertionIndex(undefined);
            }
          }}
          onClose={() => { setCreatingPage(undefined); setPageInsertionIndex(undefined); }}
        />
      )}
      {blockLibraryOpen && (
        <BlockLibraryModal
          workspaceDefinitions={workspaceDefinitions}
          pageTemplates={pageTemplates}
          template={template}
          library={library}
          root={root}
          onClose={() => setBlockLibraryOpen(false)}
          onUsePageTemplate={(page) =>
            addBlock(instantiatePageTemplate(page, randomId(), template))
          }
          onUsePrepackaged={(definition) =>
            addBlock(instantiateComponentDefinition(definition))
          }
          onUseDefinition={(definition) =>
            addBlock(instantiateComponentDefinition(definition))
          }
          onSaveDefinition={async (definition) =>
            onDefinitionsChange([...workspaceDefinitions, definition])
          }
          onDeleteDefinition={async (definition) =>
            onDefinitionsChange(
              workspaceDefinitions.filter(
                (item) =>
                  item.type !== definition.type ||
                  item.version !== definition.version,
              ),
            )
          }
        />
      )}
      {formattingBlockId &&
        (() => {
          const block = findBlock(template.starterBlocks, formattingBlockId);
          return block ? (
            <BlockFormattingModal
              block={block}
              template={template}
              library={library}
              scope="template"
              onClose={() => setFormattingBlockId(undefined)}
              onSave={(presentation, layout) => {
                updateBlock(block.id, { presentation, layout });
                setFormattingBlockId(undefined);
              }}
            />
          ) : null;
        })()}
      {conditionBlockId && (() => {
        const block = findBlock(template.starterBlocks, conditionBlockId);
        return block ? <ConditionModal value={block.condition} template={template} onClose={() => setConditionBlockId(undefined)} onSave={condition => { updateBlock(block.id, { condition }); setConditionBlockId(undefined); }} /> : null;
      })()}
      {canvasBlockId &&
        (() => {
          const block = findBlock(template.starterBlocks, canvasBlockId);
          return block?.type === "canvas" ? (
            <CanvasDesigner
              block={block}
              document={createBulletin(template)}
              template={template}
              scope="template"
              marginIn={template.theme.marginIn}
              assets={{}}
              root={root}
              definitions={workspaceDefinitions}
              library={library}
              imageTargetFolder="assets/canvases"
              onLibraryChange={onLibraryChange}
              onError={message => setSaveStatus(message)}
              onChooseAsset={async () =>
                root && window.bulletin
                  ? window.bulletin.importAsset(root, "assets/canvases")
                  : null
              }
              onChange={(next) => updateBlock(next.id, next)}
              history={history}
              onClose={() => setCanvasBlockId(undefined)}
            />
          ) : null;
        })()}
      {templatePageBlockId &&
        (() => {
          const block = template.starterBlocks.find(
            (item) => item.id === templatePageBlockId,
          );
          if (block?.type !== "templatePage") return null;
          const page: PageTemplateV1 = {
            schemaVersion: 1,
            id: block.source.id,
            version: block.source.version,
            name: block.name,
            status: "draft",
            layout: block.pageLayout,
            margin: block.margin,
            blocks: block.blocks,
            updatedAt: template.updatedAt,
          };
          return (
            <PageTemplateEditor
              value={page}
              template={template}
              library={library}
              root={root}
              definitions={workspaceDefinitions}
              onLibraryChange={onLibraryChange}
              onError={message => setSaveStatus(message)}
              onChange={(next) =>
                updateBlock(block.id, {
                  name: next.name,
                  pageLayout: next.layout,
                  margin: next.margin,
                  blocks: next.blocks,
                  sourceDigest:
                    block.sourceDigest || pageTemplateDigest(next),
                })
              }
              history={history}
              onClose={() => setTemplatePageBlockId(undefined)}
            />
          );
        })()}
      {imageIndex !== undefined && root && <ImageAssetDialog
        library={library}
        root={root}
        targetFolder={`assets/templates/${template.id}`}
        onLibraryChange={onLibraryChange}
        onError={message => setSaveStatus(message)}
        onClose={() => setImageIndex(undefined)}
        onSelect={asset => addBlock({ id: `image-${randomId()}`, type: "image", asset, alt: asset.alt, fit: "contain", heightIn: 2.5 }, imageIndex)}
      />}
      {elementParentId && <ElementPickerDialog items={flowElementPaletteItems(workspaceDefinitions, false).filter(item => findBlock(template.starterBlocks, elementParentId)?.type !== 'group' || (findBlock(template.starterBlocks, elementParentId) as Extract<BulletinBlock, { type: 'group' }>).layoutMode !== 'table' || (item.payload as ElementPalettePayload).kind === 'component' && (item.payload as Extract<ElementPalettePayload, { kind: 'component' }>).definition.type === 'bulletin:text')} onSelect={useChildPaletteItem} onClose={() => { setElementParentId(undefined); setElementCell(undefined); }} />}
      {childImageTarget && root && <ImageAssetDialog
        library={library}
        root={root}
        targetFolder={`assets/templates/${template.id}`}
        onLibraryChange={onLibraryChange}
        onError={message => setSaveStatus(message)}
        onClose={() => setChildImageTarget(undefined)}
        onSelect={asset => { addChildBlock(childImageTarget.parentId, { id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }, childImageTarget.cell); setChildImageTarget(undefined); }}
      />}
    </div>
  );
}
