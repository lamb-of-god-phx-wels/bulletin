import { Fragment, useEffect, useState, type ReactNode } from "react";
import { BlockFormattingModal } from "./BlockFormattingModal";
import { BlockLibraryModal } from "./BlockLibraryModal";
import { ScriptureEditor } from "./ScriptureEditor";
import { CanvasDesigner } from "./CanvasDesigner";
import { PageTemplateEditor } from "./PageTemplateEditor";
import { SortableHandle, SortableItem, SortableList } from "./SortableList";
import { ElementPalette, type ElementPaletteItem } from "./ElementPalette";
import { PageElementDialog } from "./PageElementDialog";
import { SongBlockFields } from "./SongBlockFields";
import { LibraryTextFields } from "./LibraryTextFields";
import { ImageAssetDialog } from "./ImageAssetDialog";
import { ImageBlockFields } from "./ImageBlockFields";
import { AnnouncementFields } from "./AnnouncementFields";
import { ListFields } from "./ListFields";
import { CopyrightFields } from "./CopyrightFields";
import { ResponsiveReadingFields } from "./ResponsiveReadingFields";
import { ResponsiveReadingSettingsFields } from "./ResponsiveReadingSettingsFields";
import { instantiateComponentDefinition } from "../componentDefinitions";
import { childBlocks, createLayoutContainer, findBlock, updateBlockTree } from "../shared/blocks";
import { libraryFamilies } from "../shared/library";
import { paragraphsFromPlainText } from "../shared/plainText";
import {
  effectiveResponsiveReadingSettings,
  updateResponsiveReaderLabels,
} from "../shared/responsiveReading";
import { insertWeeklyBlock, removeWeeklyBlock } from "../shared/weeklyBlocks";
import { flowElementPaletteItems, type ElementPalettePayload } from "./elementPaletteCatalog";
import { randomId } from "../shared/id";
import {
  churchEventDisplayName,
  churchEventsForDate,
} from "../shared/churchCalendar";
import {
  explodeTemplatePage,
  instantiatePageTemplate,
  pageTemplateDigest,
  pageTemplateVersions,
} from "../shared/pageTemplates";
import type {
  BulletinBlock,
  BulletinDocumentV1,
  LibraryManifestV1,
  PageTemplateV1,
  Paragraph,
  TemplateV1,
} from "../shared/types";
import type { UndoRedoCommands } from "./useUndoRedo";
import { RichTextEditor } from "./RichTextEditor";
import { ThisSundayProperties, WeeklyPropertiesPanel } from "./CustomProperties";
import { ConditionModal } from "./ConditionModal";
import { blockDisplayName } from "../shared/blockNames";
import { EditableElementName } from "./EditableElementName";
import { TemplateElementDialog } from "./TemplateElementDialog";
import { explodeTemplateInstance, instantiateTemplate, templateVersions } from "../shared/templates";
import { RichTextBindingControl } from "./RichTextBindingControl";
import { boundRichTextParagraphs } from "../shared/canvas";

const paragraphs = (text: string): Paragraph[] => paragraphsFromPlainText(text);
const paragraphText = (content: Paragraph[]) =>
  content
    .map((p) =>
      p.children
        .map((c) =>
          c.type === "text" ? c.text : c.type === "lineBreak" ? "\n" : "✠",
        )
        .join(""),
    )
    .join("\n\n");
export function WeeklyEditor({
  document,
  template,
  templates,
  pageTemplates,
  library,
  root,
  relativePath,
  onChange,
  history,
  onLibraryChange,
  onError,
  onOpenChurchCalendar,
}: {
  document: BulletinDocumentV1;
  template: TemplateV1;
  templates: TemplateV1[];
  pageTemplates: PageTemplateV1[];
  library?: LibraryManifestV1;
  root?: string;
  relativePath: string;
  onChange(document: BulletinDocumentV1): void;
  history: UndoRedoCommands;
  onLibraryChange(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError(message: string): void;
  onOpenChurchCalendar?(): void;
}) {
  const bulletinTemplate: TemplateV1 = { ...template, customProperties: document.customProperties ?? template.customProperties };
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const [canvasBlockId, setCanvasBlockId] = useState<string>();
  const [templatePageBlockId, setTemplatePageBlockId] = useState<string>();
  const [blockLibraryIndex, setBlockLibraryIndex] = useState<number>();
  const [pageInsertionIndex, setPageInsertionIndex] = useState<number>();
  const [templateInsertionIndex, setTemplateInsertionIndex] = useState<number>();
  const [creatingPage, setCreatingPage] = useState<PageTemplateV1>();
  const [imageIndex, setImageIndex] = useState<number>();
  const [pendingAddedBlockId, setPendingAddedBlockId] = useState<string>();
  const [conditionBlockId, setConditionBlockId] = useState<string>();
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<
    Record<string, { state: "loading" | "success" | "error"; text: string }>
  >({});
  const matchingChurchEvents = churchEventsForDate(document.info.date, library?.calendarEvents ?? []);
  const responsiveReadingSettings = effectiveResponsiveReadingSettings(template, document);
  const calendarEventName = (event: (typeof matchingChurchEvents)[number]) =>
    churchEventDisplayName(event, document.info.date, library?.calendarEvents ?? []);
  useEffect(() => {
    if (!document.info.date || document.info.churchWeek) return;
    const first = churchEventsForDate(document.info.date, library?.calendarEvents ?? [])[0];
    if (first) onChange({ ...document, info: { ...document.info, churchWeek: churchEventDisplayName(first, document.info.date, library?.calendarEvents ?? []), churchEventId: first.id } });
  }, [document.id, document.info.date, document.info.churchWeek, library?.calendarEvents]);
  useEffect(() => {
    if (!propertiesOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPropertiesOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [propertiesOpen]);
  const liturgyFamilies = libraryFamilies(
    library?.items.filter((item) => item.kind === "liturgy") ?? [],
  );
  const missingLibraryReference = (block: BulletinBlock) =>
    (block.type === "song" || block.type === "libraryText") &&
    Boolean(library) &&
    !library!.items.some(
      (item) =>
        item.id === block.libraryItemId &&
        (!block.libraryItemVersion ||
          item.version === block.libraryItemVersion),
    );
  const hasWeeklyCustomBindings = (block: BulletinBlock) =>
    block.type === "custom" &&
    block.bindings.some((binding) => binding.source === "weekly");
  const updateInfo = (key: keyof BulletinDocumentV1["info"], value: string) => {
    if (key === "date") {
      const first = churchEventsForDate(value, library?.calendarEvents ?? [])[0];
      onChange({ ...document, info: { ...document.info, date: value, churchWeek: first ? churchEventDisplayName(first, value, library?.calendarEvents ?? []) : "", churchEventId: first?.id } });
      return;
    }
    onChange({ ...document, info: { ...document.info, [key]: value } });
  };
  const updateChurchName = (name: string) =>
    onChange({ ...document, church: { ...document.church, name } });
  const updatePageMargin = (marginIn: number) =>
    onChange({
      ...document,
      layout: {
        ...document.layout,
        marginIn: Math.max(0, Math.min(1.25, marginIn)),
      },
    });
  const resetPageMargin = () => {
    const layout = { ...document.layout };
    delete layout.marginIn;
    onChange({
      ...document,
      layout: Object.keys(layout).length ? layout : undefined,
    });
  };
  const updateResponsiveReadingSettings = (next: typeof responsiveReadingSettings) => onChange({
    ...document,
    responsiveReading: next,
    blocks: updateResponsiveReaderLabels(document.blocks, responsiveReadingSettings, next),
  });
  const resetResponsiveReadingSettings = () => {
    const next = effectiveResponsiveReadingSettings(template);
    onChange({
      ...document,
      responsiveReading: undefined,
      blocks: updateResponsiveReaderLabels(document.blocks, responsiveReadingSettings, next),
    });
  };
  const updateBlock = (id: string, next: BulletinBlock) =>
    onChange({
      ...document,
      blocks: updateBlockTree(document.blocks, id, next),
    });
  const blockName = blockDisplayName;
  const updateChildren = (parent: BulletinBlock, children: BulletinBlock[]) => {
    if (parent.type === "churchInfo" || parent.type === "group")
      updateBlock(parent.id, { ...parent, children });
    if (parent.type === "paragraph")
      updateBlock(parent.id, {
        ...parent,
        children: children.filter((child) => child.type === "richText"),
      });
    if (parent.type === "templateInstance")
      updateBlock(parent.id, { ...parent, blocks: children });
  };
  const nestedEditors = (parent: BulletinBlock): ReactNode => {
    const children = childBlocks(parent) ?? [];
    const isParagraph = parent.type === "paragraph";
    const isScripture = parent.type === "scriptureReading";
    const reorderable = !isParagraph && !isScripture;
    const editors = children.map((child) => {
      const editor = (
        <details
          className="nested-block-editor collapsible-editor"
          data-editor-block-id={child.id}
          tabIndex={-1}
        >
          <summary>
            <div>
              <span className="block-type">
                {child.type}
                {child.presentation ? " · formatted" : ""}
              </span>
              <EditableElementName as="b" value={blockName(child)} onRename={displayName => updateBlock(child.id, { ...child, displayName })} />
            </div>
            <div
              className="reorder"
              onClick={(event) => event.preventDefault()}
            >
              <button className={`format-block-button condition-toggle ${child.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(child.condition)} title="Set conditional visibility" onClick={() => setConditionBlockId(child.id)}>Condition</button>
              <button
                className="format-block-button format-action"
                onClick={() => setFormattingBlockId(child.id)}
              >
                Format
              </button>
              {!isScripture && (!isParagraph || child.role === "header") && (
                <button
                  className="danger-text"
                  title="Remove element"
                  onClick={() =>
                    updateChildren(
                      parent,
                      children.filter((item) => item.id !== child.id),
                    )
                  }
                >
                  ×
                </button>
              )}
              {reorderable && (
                <SortableHandle label={`Drag ${blockName(child)} to reorder`} />
              )}
            </div>
          </summary>
          <div className="collapsible-editor-fields">
            {isScripture ? (
              <p className="helper">
                Edit this element’s content above. Use Format for its width,
                placement, spacing, typography, fill, and border.
              </p>
            ) : (
              <>
                {(child.type === "heading" ||
                  child.type === "sectionHeading" ||
                  child.type === "sermonTitle") && (
                  <label>
                    Heading
                    <RichTextEditor content={child.content ?? paragraphs(child.text)} label="Heading text" onChange={content => updateBlock(child.id, { ...child, text: paragraphText(content), content })} />
                  </label>
                )}
                {child.type === "richText" && (
                  <><RichTextBindingControl value={child.binding} template={bulletinTemplate} library={library} root={root} onChange={binding => updateBlock(child.id, { ...child, binding, bindingOverride: undefined })} /><label>
                    {child.role === "header"
                      ? "Header text"
                      : child.role === "body"
                        ? "Paragraph text"
                        : "Text"}
                    <RichTextEditor content={boundRichTextParagraphs(child, document, bulletinTemplate, library)} label={child.role === "header" ? "Header text" : "Paragraph text"} onChange={content => updateBlock(child.id, child.binding ? { ...child, bindingOverride: content } : { ...child, content })} />
                  </label>{child.bindingOverride && <button className="text-button" onClick={() => updateBlock(child.id, { ...child, bindingOverride: undefined })}>Reset to bound value</button>}</>
                )}
                {childBlocks(child) && nestedEditors(child)}
              </>
            )}
          </div>
        </details>
      );
      return reorderable ? (
        <SortableItem id={child.id} key={child.id}>
          {editor}
        </SortableItem>
      ) : (
        <Fragment key={child.id}>{editor}</Fragment>
      );
    });
    return (
      <div className="nested-blocks">
        <div className="nested-blocks-heading">
          <b>
            {isScripture
              ? "Element layout"
              : isParagraph
                ? "Text blocks"
                : "Paragraphs"}
          </b>
          <span>
            {isScripture
              ? "Heading, reference, caption, and body can be positioned and formatted independently."
              : isParagraph
                ? "Header and body formatting are completely independent."
                : "Each paragraph keeps its header and body together."}
          </span>
        </div>
        {reorderable ? (
          <SortableList
            items={children}
            onChange={(next) => updateChildren(parent, next)}
          >
            {editors}
          </SortableList>
        ) : (
          editors
        )}
        {!isScripture && (
          <div className="nested-add-actions">
            {isParagraph ? (
              !children.some(
                (child) => child.type === "richText" && child.role === "header",
              ) && (
                <button
                  className="secondary"
                  onClick={() =>
                    updateChildren(parent, [
                      {
                        id: `${parent.id}-header`,
                        type: "richText",
                        role: "header",
                        content: paragraphs("New heading"),
                        presentation: {
                          fontWeight: "bold",
                          marginIn: { top: 0, bottom: 0 },
                          paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
                        },
                      },
                      ...children,
                    ])
                  }
                >
                  ＋ Header
                </button>
              )
            ) : (
              <button
                className="secondary"
                onClick={() =>
                  updateChildren(parent, [
                    ...children,
                    {
                      id: `paragraph-${Date.now()}`,
                      type: "paragraph",
                      children: [
                        {
                          id: `paragraph-body-${Date.now()}`,
                          type: "richText",
                          role: "body",
                          content: paragraphs("New text"),
                          presentation: {
                            marginIn: { top: 0, bottom: 0 },
                            paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
                          },
                        },
                      ],
                    },
                  ])
                }
              >
                ＋ Paragraph
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  const addBlock = (
    definition: Parameters<typeof instantiateComponentDefinition>[0],
  ) => {
    const block = {
      ...instantiateComponentDefinition(definition),
      weeklyEditable: true,
    } as BulletinBlock;
    onChange({
      ...document,
      blocks: insertWeeklyBlock(document.blocks, block, blockLibraryIndex),
    });
    setPendingAddedBlockId(block.id);
    setBlockLibraryIndex(undefined);
  };
  useEffect(() => {
    if (!pendingAddedBlockId) return;
    const target = window.document.querySelector<HTMLElement>(
      `[data-editor-block-id="${CSS.escape(pendingAddedBlockId)}"]`,
    );
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("editor-block-focus");
    const timer = window.setTimeout(
      () => target.classList.remove("editor-block-focus"),
      1800,
    );
    setPendingAddedBlockId(undefined);
    return () => window.clearTimeout(timer);
  }, [document.blocks, pendingAddedBlockId]);
  const addPage = async (index = document.blocks.length, imageOnly = false) => {
    if (!root || !window.bulletin) return;
    if (imageOnly) {
      setImageIndex(index);
      return;
    }
    try {
      const asset = await window.bulletin.importAsset(
        root,
        `${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`,
      );
      if (!asset) return;
      const block: BulletinBlock = {
        id: `page-${Date.now()}`,
        type: "fullPageAsset",
        asset,
        weeklyEditable: true,
      };
      onChange({
        ...document,
        blocks: insertWeeklyBlock(document.blocks, block, index),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const usePaletteItem = (item: ElementPaletteItem, index: number) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === "component") {
      const block = { ...instantiateComponentDefinition(payload.definition), weeklyEditable: true } as BulletinBlock;
      onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, block, index) });
      setPendingAddedBlockId(block.id);
    } else if (payload.kind === "container") {
      const block = { ...createLayoutContainer(payload.layoutMode, `container-${randomId()}`), weeklyEditable: true };
      onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, block, index) });
      setPendingAddedBlockId(block.id);
    } else if (payload.kind === "page") setPageInsertionIndex(index);
    else if (payload.kind === "template") setTemplateInsertionIndex(index);
    else if (payload.kind === "image") void addPage(index, true);
    else if (payload.kind === "fullPageAsset") void addPage(index);
  };
  const chooseBlockAsset = async (
    block: Extract<BulletinBlock, { type: "fullPageAsset" }>,
  ) => {
    if (!root || !window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(
        root,
        `${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`,
      );
      if (asset) updateBlock(block.id, { ...block, asset });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const chooseCanvasAsset = async () => {
    if (!root || !window.bulletin) return null;
    try {
      return await window.bulletin.importAsset(
        root,
        `${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const lookup = async (
    block: Extract<BulletinBlock, { type: "scriptureReading" }>,
  ) => {
    if (!window.bulletin) {
      setLookupStatus((current) => ({
        ...current,
        [block.id]: {
          state: "error",
          text: "Passage import is unavailable. Open the passage and paste the approved text manually.",
        },
      }));
      onError("Passage import is unavailable. Paste the approved text manually.");
      return;
    }
    setLookupStatus((current) => ({
      ...current,
      [block.id]: {
        state: "loading",
        text: "Loading the public Bible Gateway passage…",
      },
    }));
    try {
      const resolved = await window.bulletin.lookupScripture({
        reference: block.reference,
        translation: block.translation,
      });
      updateBlock(block.id, { ...block, resolved });
      setLookupStatus((current) => ({
        ...current,
        [block.id]: {
          state: "success",
          text: `Added ${block.reference} (${block.translation.toUpperCase()}).`,
        },
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `Passage import failed: ${detail}`;
      setLookupStatus((current) => ({
        ...current,
        [block.id]: { state: "error", text: message },
      }));
      onError(message);
    }
  };
  const openScripture = async (
    block: Extract<BulletinBlock, { type: "scriptureReading" }>,
  ) => {
    try {
      if (window.bulletin)
        await window.bulletin.openScripture(block.reference, block.translation);
      else
        window.open(
          `https://www.biblegateway.com/passage/?search=${encodeURIComponent(block.reference)}&version=${encodeURIComponent(block.translation)}`,
          "_blank",
          "noopener,noreferrer",
        );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="editor-scroll">
      <section className="editor-card essentials">
        <div className="essentials-heading"><div className="eyebrow">This Week</div><button type="button" className="secondary properties-menu-button" onClick={() => setPropertiesOpen(true)}><span aria-hidden="true">⚙</span> Properties</button></div>
        <label>
          Service date
          <input
            type="date"
            value={document.info.date}
            onChange={(e) => updateInfo("date", e.target.value)}
          />
        </label>
        <div className="church-event-field">
          <label>Church event<select value={matchingChurchEvents.some(event => event.id === document.info.churchEventId) ? document.info.churchEventId : ''} onChange={event => {
            const selected = matchingChurchEvents.find(item => item.id === event.target.value);
            onChange({ ...document, info: { ...document.info, churchEventId: selected?.id, churchWeek: selected ? calendarEventName(selected) : document.info.churchWeek } });
          }}><option value="">Custom text</option>{matchingChurchEvents.map(event => <option value={event.id} key={event.id}>{calendarEventName(event)}</option>)}</select></label>
          <label>Bulletin text<input value={document.info.churchWeek} placeholder={matchingChurchEvents.length ? 'Church event text' : 'No calendar event for this date'} onChange={event => updateInfo("churchWeek", event.target.value)} /></label>
          <div>{document.info.churchEventId && (() => { const selected = matchingChurchEvents.find(event => event.id === document.info.churchEventId); return selected && calendarEventName(selected) !== document.info.churchWeek; })() && <button className="text-button" onClick={() => {
            const selected = matchingChurchEvents.find(event => event.id === document.info.churchEventId);
            if (selected) onChange({ ...document, info: { ...document.info, churchWeek: calendarEventName(selected) } });
          }}>Reset to calendar value</button>}{!matchingChurchEvents.length && <button className="text-button" onClick={onOpenChurchCalendar}>Add event in Church Calendar</button>}</div>
        </div>
        <label>
          Series
          <input
            value={document.info.series ?? ""}
            onChange={(e) => updateInfo("series", e.target.value)}
          />
        </label>
        <label>
          Sermon title
          <input
            value={document.info.title}
            onChange={(e) => updateInfo("title", e.target.value)}
          />
        </label>
        <label>
          Church name
          <input
            value={document.church.name}
            onChange={(e) => updateChurchName(e.target.value)}
          />
        </label>
        <ThisSundayProperties document={document} template={template} onChange={onChange} />
      </section>
      {propertiesOpen && <div className="modal-backdrop bulletin-properties-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPropertiesOpen(false); }}>
        <section className="bulletin-properties-modal" role="dialog" aria-modal="true" aria-labelledby="bulletin-properties-title">
          <header><div><div className="eyebrow">Bulletin settings</div><h2 id="bulletin-properties-title">Properties</h2></div><button aria-label="Close properties" onClick={() => setPropertiesOpen(false)}>×</button></header>
          <div className="bulletin-properties-sections">
            <section className="editor-card properties-section">
              <header className="properties-section-heading"><div className="eyebrow">Document</div><h3>Page setup</h3></header>
              <div className="properties-section-body">
                <p className="helper">Physical page: 7 × 8.5 inches. The PDF print dialog should use no additional margins.</p>
                <div className="page-margin-control"><label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={document.layout?.marginIn ?? template.theme.marginIn} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updatePageMargin(event.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to this bulletin only. Template default: {template.theme.marginIn} in.</small></label><button type="button" className="text-button" disabled={document.layout?.marginIn === undefined} onClick={resetPageMargin}>Use template margin</button></div>
              </div>
            </section>
            <section className="editor-card properties-section">
              <header className="properties-section-heading"><div className="eyebrow">Document</div><h3>Responsive readings</h3></header>
              <div className="properties-section-body">
                <ResponsiveReadingSettingsFields value={responsiveReadingSettings} onChange={updateResponsiveReadingSettings} />
                <button type="button" className="text-button" disabled={!document.responsiveReading} onClick={resetResponsiveReadingSettings}>Reset to template defaults</button>
              </div>
            </section>
            <WeeklyPropertiesPanel document={document} template={template} onChange={onChange} />
          </div>
          <footer><button type="button" className="primary" onClick={() => setPropertiesOpen(false)}>Done</button></footer>
        </section>
      </div>}
      <div className="editor-section-title">
        <div>
          <div className="eyebrow">Order of worship</div>
          <h2>Weekly content</h2>
          <small>
            {document.blocks.length} blocks · changes apply only to this
            bulletin
          </small>
        </div>
      </div>
      <SortableList
        items={document.blocks}
        onChange={(blocks) => onChange({ ...document, blocks })}
        onInsert={(descriptor, index) => usePaletteItem(descriptor as ElementPaletteItem, index)}
        dockedPalette
        palette={<ElementPalette
          items={flowElementPaletteItems(library?.componentDefinitions ?? [])}
          portalTargetId="app-element-palette-slot"
          onUse={item => usePaletteItem(item, document.blocks.length)}
          actions={<button className="text-button" onClick={() => setBlockLibraryIndex(document.blocks.length)}>Manage components…</button>}
        />}
      >
        {document.blocks.map((block, index) => (
          <SortableItem id={block.id} key={block.id}>
            <details
              className="editor-card block-editor collapsible-editor"
              data-editor-block-id={block.id}
              tabIndex={-1}
            >
              <summary>
                <div>
                  <span className="block-type">
                    {block.type}
                    {block.presentation ? " · formatted" : ""}
                  </span>
                  <EditableElementName as="h3" value={blockName(block)} onRename={displayName => updateBlock(block.id, { ...block, displayName })} />
                </div>
                <div
                  className="reorder"
                  onClick={(event) => event.preventDefault()}
                >
                  <button className={`format-block-button condition-toggle ${block.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(block.condition)} title="Set conditional visibility" onClick={() => setConditionBlockId(block.id)}>Condition</button>
                  {block.type === "templateInstance" ? <>
                    <button className="format-block-button" onClick={() => {
                      const source = templates.find(item => item.id === block.source.id && item.version === block.source.version && item.status === "published");
                      if (source) updateBlock(block.id, { ...instantiateTemplate(source, block.id, bulletinTemplate, document.blocks.filter(item => item.id !== block.id)), condition: block.condition, displayName: block.displayName });
                    }}>Reset</button>
                    <button className="format-block-button" onClick={() => {
                      const latest = templateVersions(templates.map(item => ({ path: "", template: item })), block.source.id).find(item => item.template.status === "published")?.template;
                      if (latest && latest.version !== block.source.version && window.confirm(`Replace local changes with ${latest.name} v${latest.version}?`))
                        updateBlock(block.id, { ...instantiateTemplate(latest, block.id, bulletinTemplate, document.blocks.filter(item => item.id !== block.id)), condition: block.condition, displayName: block.displayName });
                    }}>Upgrade</button>
                    <button className="format-block-button" onClick={() => onChange({ ...document, blocks: explodeTemplateInstance(document.blocks, block.id) })}>Explode</button>
                  </> : <button
                      className="format-block-button format-action"
                      title="Format block"
                      onClick={() => setFormattingBlockId(block.id)}
                    >
                      Format
                    </button>}
                  <button
                    className="danger-text"
                    title={`Remove ${blockName(block)}`}
                    aria-label={`Remove ${blockName(block)}`}
                    onClick={() =>
                      onChange({
                        ...document,
                        blocks: removeWeeklyBlock(document.blocks, block.id),
                      })
                    }
                  >
                    ×
                  </button>
                  <SortableHandle
                    label={`Drag ${blockName(block)} to reorder`}
                  />
                </div>
              </summary>
              <div className="collapsible-editor-fields">
                {missingLibraryReference(block) && !block.weeklyEditable && (
                  <div className="missing-template-content">
                    <b>Template content needs attention</b>
                    <span>
                      This block is normally hidden during weekly editing, but
                      its library item is missing. Choose a replacement below or
                      remove it from this bulletin.
                    </span>
                  </div>
                )}
                {(block.type === "sermonTitle" ||
                  block.type === "heading" ||
                  block.type === "sectionHeading") && (
                  <label>
                    Text
                    <RichTextEditor content={block.content ?? paragraphs(block.text)} label="Text" onChange={content => updateBlock(block.id, { ...block, text: paragraphText(content), content })} />
                  </label>
                )}
                {block.type === "richText" && (
                  <><RichTextBindingControl value={block.binding} template={bulletinTemplate} library={library} root={root} onChange={binding => updateBlock(block.id, { ...block, binding, bindingOverride: undefined })} /><label>{block.binding ? 'Override' : 'Text'}<RichTextEditor content={boundRichTextParagraphs(block, document, bulletinTemplate, library)} label="Text" onChange={content => updateBlock(block.id, block.binding ? { ...block, bindingOverride: content } : { ...block, content })} /></label>{block.bindingOverride && <button className="text-button" onClick={() => updateBlock(block.id, { ...block, bindingOverride: undefined })}>Reset to bound value</button>}</>
                )}
                {block.type === "paragraph" && nestedEditors(block)}
                {block.type === "templateInstance" && nestedEditors(block)}
                {block.type === "responsiveReading" && (
                  <ResponsiveReadingFields block={block} settings={responsiveReadingSettings} template={template} onChange={next => updateBlock(block.id, next)} />
                )}
                {block.type === "scriptureReading" && (
                  <>
                    <div className="field-row">
                      <label>
                        Heading (optional)
                        <input
                          value={block.label ?? ""}
                          placeholder="First Reading"
                          onChange={(e) =>
                            updateBlock(block.id, {
                              ...block,
                              label: e.target.value || undefined,
                            })
                          }
                        />
                      </label>
                      <label>
                        Scripture reference
                        <input
                          value={block.reference}
                          placeholder="Matthew 9:9-13"
                          onChange={(e) =>
                            updateBlock(block.id, {
                              ...block,
                              reference: e.target.value,
                              resolved: undefined,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="field-row">
                      <label>
                        Heading and reference
                        <select
                          value={block.headingReferenceLayout ?? "inline"}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              ...block,
                              headingReferenceLayout: event.target.value as
                                "inline" | "stacked",
                            })
                          }
                        >
                          <option value="inline">Same line</option>
                          <option value="stacked">Stacked</option>
                        </select>
                      </label>
                      <label>
                        Space between (inches)
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.01"
                          disabled={
                            (block.headingReferenceLayout ?? "inline") !==
                            "inline"
                          }
                          value={block.headingReferenceGapIn ?? 0.12}
                          onChange={(event) => {
                            if (
                              Number.isFinite(event.currentTarget.valueAsNumber)
                            )
                              updateBlock(block.id, {
                                ...block,
                                headingReferenceGapIn: Math.max(
                                  0,
                                  event.currentTarget.valueAsNumber,
                                ),
                              });
                          }}
                        />
                      </label>
                    </div>
                    <div className="field-row">
                      <label>
                        Caption (optional)
                        <textarea
                          rows={2}
                          value={block.caption ?? ""}
                          onChange={(e) =>
                            updateBlock(block.id, {
                              ...block,
                              caption: e.target.value || undefined,
                            })
                          }
                        />
                      </label>
                      <label>
                        Translation code
                        <input
                          value={block.translation}
                          placeholder="NIV"
                          onChange={(e) =>
                            updateBlock(block.id, {
                              ...block,
                              translation: e.target.value,
                              resolved: undefined,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="scripture-actions">
                      <button
                        className="secondary scripture-fetch"
                        disabled={
                          lookupStatus[block.id]?.state === "loading" ||
                          !block.reference.trim()
                        }
                        onClick={() => lookup(block)}
                      >
                        {lookupStatus[block.id]?.state === "loading"
                          ? "Importing…"
                          : "Import passage"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => openScripture(block)}
                      >
                        Open on Bible Gateway ↗
                      </button>
                    </div>
                    {lookupStatus[block.id] && (
                      <p
                        className={`lookup-status ${lookupStatus[block.id].state}`}
                        role={lookupStatus[block.id].state === "error" ? "alert" : "status"}
                        aria-live={lookupStatus[block.id].state === "error" ? "assertive" : "polite"}
                      >
                        {lookupStatus[block.id].state === "error" && <span aria-hidden="true">⚠ </span>}{lookupStatus[block.id].text}
                      </p>
                    )}
                    <details>
                      <summary>Body — passage text or manual fallback</summary>
                      <ScriptureEditor
                        content={
                          block.resolved?.content ?? [
                            {
                              type: "paragraph",
                              children: [{ type: "text", text: "" }],
                            },
                          ]
                        }
                        onChange={(content) =>
                          updateBlock(block.id, {
                            ...block,
                            resolved: block.resolved
                              ? { ...block.resolved, content }
                              : {
                                  content,
                                  source: "manual",
                                  retrievedAt: new Date().toISOString(),
                                  attribution: `${block.translation.toUpperCase()} — text supplied by user`,
                                },
                          })
                        }
                      />
                    </details>
                    {nestedEditors(block)}
                  </>
                )}
                {block.type === "song" && <SongBlockFields
                  block={block}
                  library={library}
                  template={bulletinTemplate}
                  scope="weekly"
                  root={root}
                  onChange={next => updateBlock(block.id, next)}
                />}
                {block.type === "libraryText" &&
                  (() => {
                    const family = liturgyFamilies.find(item => item.id === block.libraryItemId);
                    const selected = family?.versions.find(item => item.version === block.libraryItemVersion) ?? family?.versions[0];
                    return (
                      <>
                        <LibraryTextFields block={block} library={library} root={root} onChange={next => updateBlock(block.id, next)} />
                        <details>
                          <summary>
                            Edit reusable text for this bulletin
                          </summary>
                          <textarea
                            rows={8}
                            value={paragraphText(
                              block.contentOverride ?? selected?.content ?? [],
                            )}
                            onChange={(event) =>
                              updateBlock(block.id, {
                                ...block,
                                contentOverride: paragraphs(event.target.value),
                              })
                            }
                          />
                          {block.contentOverride && (
                            <button
                              className="danger-text content-reset"
                              onClick={() =>
                                updateBlock(block.id, {
                                  ...block,
                                  contentOverride: undefined,
                                })
                              }
                            >
                              Restore library text
                            </button>
                          )}
                        </details>
                      </>
                    );
                  })()}
                {block.type === "announcements" && (
                  <AnnouncementFields block={block} library={library} root={root} targetFolder={`${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets/announcements`} onLibraryChange={onLibraryChange} onError={onError} onChange={next => updateBlock(block.id, next)} />
                )}
                {block.type === "list" && (
                  <ListFields block={block} library={library} root={root} targetFolder={`${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets/lists`} onLibraryChange={onLibraryChange} onError={onError} onChange={next => updateBlock(block.id, next)} />
                )}
                {block.type === "custom" && (
                  <div className="custom-weekly-fields">
                    <div className="field-row">
                      <label>
                        Block heading
                        <input
                          value={block.name}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              ...block,
                              name: event.target.value,
                              label: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Content layout
                        <textarea
                          rows={3}
                          value={block.layoutText}
                          onChange={(event) =>
                            updateBlock(block.id, {
                              ...block,
                              layoutText: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    {block.bindings
                      .filter((binding) => binding.source === "weekly")
                      .map((binding) => (
                        <label key={binding.key}>
                          {binding.label}
                          {binding.multiline ? (
                            <textarea
                              rows={4}
                              value={
                                block.values?.[binding.key] ??
                                binding.defaultValue ??
                                ""
                              }
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  ...block,
                                  values: {
                                    ...block.values,
                                    [binding.key]: event.target.value,
                                  },
                                })
                              }
                            />
                          ) : (
                            <input
                              value={
                                block.values?.[binding.key] ??
                                binding.defaultValue ??
                                ""
                              }
                              onChange={(event) =>
                                updateBlock(block.id, {
                                  ...block,
                                  values: {
                                    ...block.values,
                                    [binding.key]: event.target.value,
                                  },
                                })
                              }
                            />
                          )}
                        </label>
                      ))}
                    {!hasWeeklyCustomBindings(block) && (
                      <p className="helper">
                        This block is filled automatically from bulletin
                        details.
                      </p>
                    )}
                  </div>
                )}
                {block.type === "canvas" && (
                  <>
                    <p className="helper">
                      Position bound text, images, shapes, and lines within this
                      canvas block.
                    </p>
                    <button
                      className="primary"
                      onClick={() => setCanvasBlockId(block.id)}
                    >
                      Open canvas designer
                    </button>
                  </>
                )}
                {block.type === "templatePage" && (
                  <div className="template-page-instance-controls">
                    <p className="helper">
                      Pinned to {block.source.id} v{block.source.version}. It
                      remains one page until exploded.
                    </p>
                    <div className="builder-actions">
                      <button
                        className="primary"
                        onClick={() => setTemplatePageBlockId(block.id)}
                      >
                        Edit page overrides
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const source = pageTemplates.find(
                            (page) =>
                              page.id === block.source.id &&
                              page.version === block.source.version,
                          );
                          if (source)
                            updateBlock(
                              block.id,
                              instantiatePageTemplate(source, block.id, bulletinTemplate),
                            );
                        }}
                      >
                        Reset changes
                      </button>
                      <button
                        className="secondary"
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
                              instantiatePageTemplate(latest, block.id, bulletinTemplate),
                            );
                        }}
                      >
                        Upgrade
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Explode this page into native document blocks? Its blocks will adopt the bulletin margins.",
                            )
                          )
                            onChange({
                              ...document,
                              blocks: explodeTemplatePage(
                                document.blocks,
                                block.id,
                              ),
                            });
                        }}
                      >
                        Explode
                      </button>
                    </div>
                  </div>
                )}
                {(block.type === "churchInfo" || block.type === "group") &&
                  <>{block.type === 'group' && <div className="field-row container-options">
                    <label>Layout<select value={block.layoutMode ?? 'stack'} onChange={event => updateBlock(block.id, { ...block, layoutMode: event.target.value as NonNullable<typeof block.layoutMode> })}><option value="stack">Stack</option><option value="grid">Grid</option><option value="table">Table</option></select></label>
                    {(block.layoutMode ?? 'stack') !== 'stack' && <label>Columns<input type="number" min="1" max="12" value={block.columns ?? 2} onChange={event => updateBlock(block.id, { ...block, columns: Math.max(1, Math.min(12, event.currentTarget.valueAsNumber || 1)) })} /></label>}
                    {(block.layoutMode ?? 'stack') !== 'table' && <label>Gap (in)<input type="number" min="0" max="2" step=".025" value={block.gapIn ?? .12} onChange={event => updateBlock(block.id, { ...block, gapIn: Math.max(0, event.currentTarget.valueAsNumber || 0) })} /></label>}
                  </div>}{nestedEditors(block)}</>}
                {block.type === "copyright" && (
                  <CopyrightFields block={block} onChange={next => updateBlock(block.id, next)} />
                )}
                {block.type === "spacer" && (
                  <label>
                    Spacer size
                    <select
                      value={block.size}
                      onChange={(event) =>
                        updateBlock(block.id, {
                          ...block,
                          size: event.target.value as
                            "small" | "medium" | "large",
                        })
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </label>
                )}
                {block.type === "fullPageAsset" && (
                  <>
                    <p className="helper">
                      {block.asset.alt ?? block.asset.path}
                    </p>
                    <div className="builder-actions">
                      <button
                        className="secondary"
                        onClick={() => chooseBlockAsset(block)}
                      >
                        Replace page asset
                      </button>
                      <button
                        className="danger-text"
                        onClick={() =>
                          onChange({
                            ...document,
                            blocks: removeWeeklyBlock(
                              document.blocks,
                              block.id,
                            ),
                          })
                        }
                      >
                        Remove page
                      </button>
                    </div>
                  </>
                )}
                {block.type === "image" && (
                  <ImageBlockFields block={block} library={library} root={root} targetFolder={`${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`} onLibraryChange={onLibraryChange} onError={onError} onChange={next => updateBlock(block.id, next)} />
                )}
                {missingLibraryReference(block) && !block.weeklyEditable && (
                  <button
                    className="danger-text"
                    onClick={() =>
                      onChange({
                        ...document,
                        blocks: document.blocks.filter(
                          (item) => item.id !== block.id,
                        ),
                      })
                    }
                  >
                    Remove from this bulletin
                  </button>
                )}
              </div>
            </details>
          </SortableItem>
        ))}
      </SortableList>
      {pageInsertionIndex !== undefined && !creatingPage && (
        <PageElementDialog
          pages={pageTemplates}
          library={library}
          root={root}
          onClose={() => setPageInsertionIndex(undefined)}
          onSelect={(page) => {
            onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, instantiatePageTemplate(page, randomId(), bulletinTemplate), pageInsertionIndex) });
            setPageInsertionIndex(undefined);
          }}
          onCreate={(page) => setCreatingPage(page)}
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
            onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, instantiateTemplate(source, randomId(), bulletinTemplate, document.blocks), templateInsertionIndex) });
            setTemplateInsertionIndex(undefined);
          }}
        />
      )}
      {creatingPage && (
        <PageTemplateEditor
          value={creatingPage}
          template={bulletinTemplate}
          document={document}
          library={library}
          root={root}
          definitions={library?.componentDefinitions ?? []}
          onLibraryChange={onLibraryChange}
          onError={onError}
          onChange={setCreatingPage}
          onSave={async publish => {
            if (!root || !window.bulletin) throw new Error("A workspace is required to save reusable pages.");
            const saved = { ...creatingPage, status: publish ? "published" as const : "draft" as const, updatedAt: new Date().toISOString() };
            await window.bulletin.savePageTemplate(root, saved);
            setCreatingPage(saved);
            if (publish && pageInsertionIndex !== undefined) {
              onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, instantiatePageTemplate(saved, randomId(), bulletinTemplate), pageInsertionIndex) });
              setCreatingPage(undefined);
              setPageInsertionIndex(undefined);
            }
          }}
          onClose={() => { setCreatingPage(undefined); setPageInsertionIndex(undefined); }}
        />
      )}
      {blockLibraryIndex !== undefined && (
        <BlockLibraryModal
          workspaceDefinitions={library?.componentDefinitions ?? []}
          pageTemplates={pageTemplates}
          template={bulletinTemplate}
          library={library}
          root={root}
          onClose={() => setBlockLibraryIndex(undefined)}
          onUsePageTemplate={(page) => {
            const block = instantiatePageTemplate(page, randomId(), bulletinTemplate);
            onChange({
              ...document,
              blocks: insertWeeklyBlock(
                document.blocks,
                block,
                blockLibraryIndex,
              ),
            });
            setBlockLibraryIndex(undefined);
          }}
          onUsePrepackaged={addBlock}
          onUseDefinition={addBlock}
          onSaveDefinition={async (definition) =>
            onLibraryChange({
              ...(library ?? {
                schemaVersion: 1,
                name: "Shared Library",
                items: [],
              }),
              componentDefinitions: [
                ...(library?.componentDefinitions ?? []),
                definition,
              ],
            })
          }
          onDeleteDefinition={async (definition) =>
            onLibraryChange({
              ...(library ?? {
                schemaVersion: 1,
                name: "Shared Library",
                items: [],
              }),
              componentDefinitions: (
                library?.componentDefinitions ?? []
              ).filter(
                (item) =>
                  item.type !== definition.type ||
                  item.version !== definition.version,
              ),
            })
          }
        />
      )}
      {conditionBlockId && (() => {
        const block = findBlock(document.blocks, conditionBlockId);
        return block ? <ConditionModal value={block.condition} template={bulletinTemplate} onClose={() => setConditionBlockId(undefined)} onSave={condition => { updateBlock(block.id, { ...block, condition }); setConditionBlockId(undefined); }} /> : null;
      })()}
      {formattingBlockId &&
        (() => {
          const block = findBlock(document.blocks, formattingBlockId);
          return block ? (
            <BlockFormattingModal
              block={block}
              template={bulletinTemplate}
              document={document}
              library={library}
              scope="weekly"
              onClose={() => setFormattingBlockId(undefined)}
              onSave={(presentation, layout) => {
                updateBlock(block.id, { ...block, presentation, layout });
                setFormattingBlockId(undefined);
              }}
            />
          ) : null;
        })()}
      {canvasBlockId &&
        (() => {
          const block = findBlock(document.blocks, canvasBlockId);
          return block?.type === "canvas" ? (
            <CanvasDesigner
              block={block}
              document={document}
              template={bulletinTemplate}
              scope="weekly"
              marginIn={document.layout?.marginIn ?? template.theme.marginIn}
              assets={{}}
              root={root}
              definitions={library?.componentDefinitions ?? []}
              library={library}
              onLibraryChange={onLibraryChange}
              imageTargetFolder={`${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`}
              onError={onError}
              onChooseAsset={chooseCanvasAsset}
              onChange={(next) => updateBlock(next.id, next)}
              history={history}
              onClose={() => setCanvasBlockId(undefined)}
            />
          ) : null;
        })()}
      {templatePageBlockId &&
        (() => {
          const block = document.blocks.find(
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
            updatedAt: document.updatedAt,
          };
          return (
            <PageTemplateEditor
              value={page}
              template={bulletinTemplate}
              document={document}
              library={library}
              root={root}
              definitions={library?.componentDefinitions ?? []}
              onLibraryChange={onLibraryChange}
              onError={onError}
              onChange={(next) =>
                updateBlock(block.id, {
                  ...block,
                  name: next.name,
                  pageLayout: next.layout,
                  margin: next.margin,
                  blocks: next.blocks,
                  sourceDigest: block.sourceDigest || pageTemplateDigest(next),
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
        targetFolder={`${relativePath.replace(/[/\\]bulletin\.json$/, "")}/assets`}
        onLibraryChange={onLibraryChange}
        onError={onError}
        onClose={() => setImageIndex(undefined)}
        onSelect={asset => {
          const block: BulletinBlock = { id: `image-${randomId()}`, type: "image", asset, alt: asset.alt, fit: "contain", heightIn: 2.5, weeklyEditable: true };
          onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, block, imageIndex) });
        }}
      />}
    </div>
  );
}
