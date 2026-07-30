import { useState } from "react";
import { BlockLibraryModal } from "./BlockLibraryModal";
import { BlockFormattingModal } from "./BlockFormattingModal";
import { customBlockIssues } from "../shared/customBlocks";
import { instantiateComponentDefinition } from "../componentDefinitions";
import { childBlocks, findBlock, updateBlockTree } from "../shared/blocks";
import { scriptureElementNames } from "../shared/scriptureReading";
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
import { ElementPalette, type ElementPaletteItem } from "./ElementPalette";
import { PageElementDialog } from "./PageElementDialog";
import { flowElementPaletteItems, type ElementPalettePayload } from "./elementPaletteCatalog";

const contentText = (block: Extract<BulletinBlock, { type: "richText" }>) =>
  block.content
    .map((paragraph) =>
      paragraph.children
        .map((child) =>
          child.type === "text"
            ? child.text
            : child.type === "lineBreak"
              ? "\n"
              : "✠",
        )
        .join(""),
    )
    .join("\n\n");
const textContent = (value: string) =>
  value
    .split(/\n\s*\n/)
    .map((text) => ({
      type: "paragraph" as const,
      children: [{ type: "text" as const, text: text.replace(/\n/g, " ") }],
    }));

export function TemplateBuilder({
  template,
  pageTemplates,
  workspaceDefinitions,
  library,
  root,
  onChange,
  onDefinitionsChange,
  onSave,
  onDeleteVersion,
  onDeleteTemplate,
  canDeleteVersion,
  canDeleteTemplate,
}: {
  template: TemplateV1;
  pageTemplates: PageTemplateV1[];
  workspaceDefinitions: DeclarativeComponentDefinition[];
  library?: LibraryManifestV1;
  root?: string;
  onChange(value: TemplateV1): void;
  onDefinitionsChange(value: DeclarativeComponentDefinition[]): Promise<void>;
  onSave(publish: boolean): Promise<void>;
  onDeleteVersion(): void;
  onDeleteTemplate(): void;
  canDeleteVersion: boolean;
  canDeleteTemplate: boolean;
}) {
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false);
  const [pageInsertionIndex, setPageInsertionIndex] = useState<number>();
  const [creatingPage, setCreatingPage] = useState<PageTemplateV1>();
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const [editingBlockIds, setEditingBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [canvasBlockId, setCanvasBlockId] = useState<string>();
  const [templatePageBlockId, setTemplatePageBlockId] = useState<string>();
  const toggleEditor = (id: string) =>
    setEditingBlockIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const updateTemplate = (changes: Partial<TemplateV1>) =>
    onChange({ ...template, ...changes, status: "draft" });
  const blockTitle = (block: BulletinBlock) =>
    block.type === "templatePage"
      ? block.name
      : block.type === "custom"
        ? block.name
        : block.type === "canvas"
          ? "Canvas"
          : block.type === "paragraph"
            ? contentText(
                (childBlocks(block)?.find(
                  (child) =>
                    child.type === "richText" && child.role === "header",
                ) as
                  Extract<BulletinBlock, { type: "richText" }> | undefined) ?? {
                  id: "",
                  type: "richText",
                  content: [],
                },
              ) || "Paragraph"
            : block.type === "richText" && block.scriptureRole
              ? scriptureElementNames[block.scriptureRole]
              : block.type === "richText" && block.role
                ? block.role === "header"
                  ? "Header text"
                  : "Paragraph text"
                : (block.label ?? ("text" in block ? block.text : block.type));
  const updateTheme = (
    key: keyof TemplateV1["theme"],
    value: string | number,
  ) => updateTemplate({ theme: { ...template.theme, [key]: value } });
  const addBlock = (block: BulletinBlock, index = template.starterBlocks.length) => {
    updateTemplate({ starterBlocks: [...template.starterBlocks.slice(0, index), block, ...template.starterBlocks.slice(index)] });
    setBlockLibraryOpen(false);
  };
  const usePaletteItem = async (item: ElementPaletteItem, index: number) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === "component") addBlock(instantiateComponentDefinition(payload.definition), index);
    else if (payload.kind === "page") setPageInsertionIndex(index);
    else if ((payload.kind === "image" || payload.kind === "fullPageAsset") && root && window.bulletin) {
      const asset = await window.bulletin.importAsset(root, `assets/templates/${template.id}`);
      if (!asset) return;
      if (payload.kind === "image" && asset.mediaType === "application/pdf") {
        window.alert("Choose a PNG, JPEG, or SVG for an Image element.");
        return;
      }
      addBlock(payload.kind === "image"
        ? { id: `image-${crypto.randomUUID()}`, type: "image", asset, fit: "contain", heightIn: 2.5 }
        : { id: `page-${crypto.randomUUID()}`, type: "fullPageAsset", asset }, index);
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
    block.type === "scriptureReading" ? (
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
    ) : block.type === "image" ? (
      <div className="outline-options"><label className="outline-option">Height (in)<input type="number" min=".25" max="8.5" step=".0625" value={block.heightIn ?? 2.5} onChange={event => updateBlock(block.id, { heightIn: event.currentTarget.valueAsNumber })} /></label><label className="outline-option">Fit<select value={block.fit ?? "contain"} onChange={event => updateBlock(block.id, { fit: event.target.value as "contain" | "cover" | "fill" })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label></div>
    ) : null;
  const nestedOutline = (parent: BulletinBlock): React.ReactNode =>
    parent.type !== "templatePage" &&
    childBlocks(parent) && (
      <ol className="nested-outline">
        {childBlocks(parent)!.map((child) => (
          <li
            className={childBlocks(child) ? "outline-container" : undefined}
            data-editor-block-id={child.id}
            tabIndex={-1}
            key={child.id}
          >
            <div className="outline-main">
              <b>{blockTitle(child)}</b>
              <small>
                {child.type} · Nested element
                {child.presentation ? " · Formatted" : ""}
              </small>
              {child.type === "richText" &&
                !child.scriptureRole &&
                editingBlockIds.has(child.id) && (
                  <textarea
                    className="outline-text-editor"
                    autoFocus
                    rows={child.role === "header" ? 2 : 3}
                    aria-label={`Edit ${blockTitle(child)}`}
                    value={contentText(child)}
                    onChange={(event) =>
                      updateBlock(child.id, {
                        content: textContent(event.target.value),
                      })
                    }
                  />
                )}
            </div>
            <div className="reorder">
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
            </div>
            {nestedOutline(child)}
          </li>
        ))}
      </ol>
    );
  const save = async (publish: boolean) => {
    const customIssues = template.starterBlocks.flatMap((block) =>
      block.type === "custom" ? customBlockIssues(block) : [],
    );
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
          <label>
            Body font
            <input
              value={template.theme.bodyFont}
              onChange={(event) => updateTheme("bodyFont", event.target.value)}
            />
          </label>
          <label>
            Display font
            <input
              value={template.theme.displayFont}
              onChange={(event) =>
                updateTheme("displayFont", event.target.value)
              }
            />
          </label>
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
        <details className="editor-card collapsible-editor page-setup-card">
          <summary>
            <div>
              <span className="block-type">Document</span>
              <h3>Page setup</h3>
            </div>
            <small>{template.theme.marginIn} in margins</small>
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
        </details>
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
            dockedPalette
            palette={<ElementPalette
              items={flowElementPaletteItems(workspaceDefinitions)}
              storageKey="bulletin-elements-template"
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
                    tabIndex={-1}
                  >
                    <div className="outline-main">
                      <b>{blockTitle(block)}</b>
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
                                  instantiatePageTemplate(source, block.id),
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
                                  instantiatePageTemplate(latest, block.id),
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
          onClose={() => setPageInsertionIndex(undefined)}
          onSelect={page => { addBlock(instantiatePageTemplate(page), pageInsertionIndex); setPageInsertionIndex(undefined); }}
          onCreate={setCreatingPage}
        />
      )}
      {creatingPage && (
        <PageTemplateEditor
          value={creatingPage}
          template={template}
          library={library}
          root={root}
          definitions={workspaceDefinitions}
          onChange={setCreatingPage}
          onSave={async publish => {
            if (!root || !window.bulletin) throw new Error("A workspace is required to save reusable pages.");
            const saved = { ...creatingPage, status: publish ? "published" as const : "draft" as const, updatedAt: new Date().toISOString() };
            await window.bulletin.savePageTemplate(root, saved);
            setCreatingPage(saved);
            if (publish && pageInsertionIndex !== undefined) {
              addBlock(instantiatePageTemplate(saved), pageInsertionIndex);
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
            addBlock(instantiatePageTemplate(page))
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
              scope="template"
              onClose={() => setFormattingBlockId(undefined)}
              onSave={(presentation, layout) => {
                updateBlock(block.id, { presentation, layout });
                setFormattingBlockId(undefined);
              }}
            />
          ) : null;
        })()}
      {canvasBlockId &&
        (() => {
          const block = findBlock(template.starterBlocks, canvasBlockId);
          return block?.type === "canvas" ? (
            <CanvasDesigner
              block={block}
              document={createBulletin(template)}
              marginIn={template.theme.marginIn}
              assets={{}}
              root={root}
              definitions={workspaceDefinitions}
              library={library}
              onChooseAsset={async () =>
                root && window.bulletin
                  ? window.bulletin.importAsset(root, "assets/canvases")
                  : null
              }
              onChange={(next) => updateBlock(next.id, next)}
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
              onClose={() => setTemplatePageBlockId(undefined)}
            />
          );
        })()}
    </div>
  );
}
