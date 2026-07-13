import { useState } from "react";
import type { RendererDocumentSummary } from "../bridge/index.js";
import { Button, Card, PageHeader } from "../design-system/index.js";
import {
  STARTER_CATALOG,
  StarterChooser,
  type StarterId,
} from "../onboarding/index.js";

function editedLabel(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Edited recently";
  return `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(time))}`;
}

function DocumentCard({
  document,
  onOpen,
  onCreateBulletin,
  onDuplicate,
}: {
  readonly document: RendererDocumentSummary;
  readonly onOpen: (document: RendererDocumentSummary) => void;
  readonly onCreateBulletin?: (document: RendererDocumentSummary) => void;
  readonly onDuplicate?: (document: RendererDocumentSummary) => void;
}) {
  return (
    <Card as="article" className="cbb-resource-card">
      <div>
        <h3>{document.displayName}</h3>
        <p className="cbb-resource-card__meta">
          {document.resourceKind === "template" ? "Template" : "Bulletin"} · {editedLabel(document.modifiedAt)}
        </p>
      </div>
      <p className="cbb-resource-card__state">Ready to edit</p>
      <div className="cbb-cluster">
        <Button
          variant="primary"
          data-resource-open-id={document.localResourceId}
          onClick={() => (onCreateBulletin ?? onOpen)(document)}
        >{onCreateBulletin === undefined ? "Open" : "Create bulletin"}</Button>
        {onCreateBulletin === undefined
          ? null
          : <Button onClick={() => onOpen(document)}>Edit template</Button>}
        {onDuplicate === undefined
          ? null
          : <Button variant="quiet" onClick={() => onDuplicate(document)}>Duplicate</Button>}
      </div>
    </Card>
  );
}

export function DocumentLibraryPage({
  title,
  description,
  documents,
  onOpen,
  onDuplicate,
  onCreateBulletin,
}: {
  readonly title: string;
  readonly description: string;
  readonly documents: readonly RendererDocumentSummary[];
  readonly onOpen: (document: RendererDocumentSummary) => void;
  readonly onDuplicate?: (document: RendererDocumentSummary) => void;
  readonly onCreateBulletin?: (() => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
  const visible = normalized.length === 0
    ? documents
    : documents.filter((document) => document.displayName.normalize("NFKC").toLocaleLowerCase().includes(normalized));
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={onCreateBulletin === undefined
          ? undefined
          : <Button variant="primary" onClick={onCreateBulletin}>Create This Week’s Bulletin</Button>}
      />
      <div className="cbb-field cbb-route-search">
        <label htmlFor="cbb-document-library-search">Search {title.toLocaleLowerCase()}</label>
        <input
          id="cbb-document-library-search"
          className="cbb-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <p className="cbb-muted" role="status">{visible.length} {visible.length === 1 ? "item" : "items"}</p>
      {visible.length === 0
        ? (
          <Card className="cbb-empty-state">
            <h2>No matching {title.toLocaleLowerCase()}</h2>
            <p>Try fewer search words{documents.length === 0 ? " or create the first one from a starter" : ""}.</p>
          </Card>
        )
        : (
          <div className="cbb-card-grid">
            {visible.map((document) => (
              <DocumentCard
                key={document.localResourceId}
                document={document}
                onOpen={onOpen}
                {...(onDuplicate === undefined ? {} : { onDuplicate })}
              />
            ))}
          </div>
        )}
    </div>
  );
}

export function CreateBulletinPage({
  onCreate,
  onCancel,
}: {
  readonly onCreate: (starterId: StarterId) => void;
  readonly onCancel: () => void;
}) {
  const [starterId, setStarterId] = useState<StarterId>("simple-service");
  return (
    <div className="cbb-create-bulletin">
      <PageHeader
        title="Create This Week’s Bulletin"
        description="Start with a generic accessible layout. You can change content now and customize the layout later."
      />
      <StarterChooser selected={starterId} onSelect={setStarterId} legend="Choose the finished format" />
      <div className="cbb-cluster cbb-create-bulletin__actions">
        <Button variant="primary" onClick={() => onCreate(starterId)}>Create and open</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function TemplateLibraryPage({
  documents,
  onOpen,
  onCreateBulletin,
  onDuplicate,
  onUseStarter,
}: {
  readonly documents: readonly RendererDocumentSummary[];
  readonly onOpen: (document: RendererDocumentSummary) => void;
  readonly onCreateBulletin?: (document: RendererDocumentSummary) => void;
  readonly onDuplicate?: (document: RendererDocumentSummary) => void;
  readonly onUseStarter?: (starterId: StarterId) => void;
}) {
  return (
    <div>
      <PageHeader
        title="Templates"
        description="Create a bulletin from a saved template, or use a built-in starter to design weekly fields and protected layout."
      />
      <section className="cbb-section" aria-labelledby="cbb-built-in-starters-title">
        <h2 id="cbb-built-in-starters-title">Built-in starters</h2>
        <div className="cbb-card-grid">
          {STARTER_CATALOG.map((starter) => (
            <Card as="article" className="cbb-starter-summary" key={starter.id}>
              <h3>{starter.name}</h3>
              <p>{starter.description}</p>
              <p className="cbb-muted">{starter.outputDescription} · {starter.requiredItemCount} required items</p>
              {onUseStarter === undefined
                ? null
                : <Button variant="primary" onClick={() => onUseStarter(starter.id)}>Use this starter</Button>}
            </Card>
          ))}
        </div>
      </section>
      <section className="cbb-section" aria-labelledby="cbb-saved-templates-title">
        <h2 id="cbb-saved-templates-title">Saved templates</h2>
        {documents.length === 0
          ? <p className="cbb-muted">Templates saved from Customize Layout will appear here.</p>
          : (
            <div className="cbb-card-grid">
              {documents.map((document) => (
                <DocumentCard
                  key={document.localResourceId}
                  document={document}
                  onOpen={onOpen}
                  {...(onCreateBulletin === undefined ? {} : { onCreateBulletin })}
                  {...(onDuplicate === undefined ? {} : { onDuplicate })}
                />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

export function ChurchLibraryPage() {
  const areas = [
    ["Church Profile", "Congregation name, contact details, brand colors, and local spelling dictionary."],
    ["Songs and rights", "Reusable hymn and song content with publication credit details."],
    ["Scripture", "Offline translation labels, formatting presets, and reviewed pasted passages."],
    ["Saved Sections", "Reusable bulletin sections, images, and managed fonts."],
  ] as const;
  return (
    <div>
      <PageHeader
        title="Church Library"
        description="Reusable congregation-owned content stays on this computer and is available to every bulletin."
      />
      <div className="cbb-card-grid cbb-library-foundation">
        {areas.map(([title, description]) => (
          <Card as="section" key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
            <p className="cbb-muted">The trusted storage foundation is ready; weekly catalog workflows arrive in M5.</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
