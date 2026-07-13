import { createElement as h, useDeferredValue, useId, useMemo, useState } from "react";
import { Button, Card, PageHeader } from "../design-system/index.js";

export type LibraryResourceKind = "bulletin" | "template" | "savedSection";

export interface LibraryResource {
  readonly id: string;
  readonly kind: LibraryResourceKind;
  readonly name: string;
  readonly description?: string;
  readonly publicationDate?: string;
  readonly modifiedLabel: string;
  readonly stateLabel: string;
  readonly nextAction?: string;
  readonly archived?: boolean;
}

export interface LibraryHomeProps {
  readonly resources: readonly LibraryResource[];
  readonly onCreateBulletin?: () => void;
  readonly onStartBlank?: () => void;
  readonly onOpen: (resource: LibraryResource) => void;
  readonly onDuplicate?: (resource: LibraryResource) => void;
  readonly onShowAll?: () => void;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function matches(resource: LibraryResource, query: string): boolean {
  const tokens = normalizeSearch(query).split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearch([
    resource.name,
    resource.description ?? "",
    resource.publicationDate ?? "",
    resource.stateLabel,
    resource.kind === "savedSection" ? "saved section" : resource.kind,
  ].join(" "));
  return tokens.every((token) => haystack.includes(token));
}

function ResourceCard({ resource, onOpen, onDuplicate }: {
  readonly resource: LibraryResource;
  readonly onOpen: (resource: LibraryResource) => void;
  readonly onDuplicate?: (resource: LibraryResource) => void;
}) {
  const openFocusTarget = { "data-resource-open-id": resource.id } as const;
  const kindLabel = resource.kind === "bulletin"
    ? "Bulletin"
    : resource.kind === "template" ? "Template" : "Saved section";
  return h(
    Card,
    { as: "article", className: "cbb-resource-card" },
    h("div", null,
      h("h3", null, resource.name),
      h("p", { className: "cbb-resource-card__meta" },
        [kindLabel, resource.publicationDate, resource.modifiedLabel].filter(Boolean).join(" · "),
      ),
    ),
    resource.description === undefined ? null : h("p", null, resource.description),
    h("p", { className: "cbb-resource-card__state" }, resource.stateLabel),
    resource.nextAction === undefined ? null : h("p", { className: "cbb-muted" }, resource.nextAction),
    h("div", { className: "cbb-cluster" },
      h(Button, {
        ...openFocusTarget,
        variant: "primary",
        onClick: () => onOpen(resource),
      }, resource.kind === "bulletin" ? "Open bulletin" : "Open"),
      onDuplicate === undefined ? null : h(Button, { variant: "quiet", onClick: () => onDuplicate(resource) }, "Duplicate"),
    ),
  );
}

function LibrarySection({ title, emptyText, resources, ...actions }: {
  readonly title: string;
  readonly emptyText: string;
  readonly resources: readonly LibraryResource[];
  readonly onOpen: (resource: LibraryResource) => void;
  readonly onDuplicate?: (resource: LibraryResource) => void;
}) {
  return h(
    "section",
    { className: "cbb-section", "aria-labelledby": `library-${title.replace(/\s+/gu, "-").toLowerCase()}` },
    h("h2", { id: `library-${title.replace(/\s+/gu, "-").toLowerCase()}` }, title),
    resources.length === 0
      ? h("p", { className: "cbb-muted" }, emptyText)
      : h("div", { className: "cbb-card-grid" }, ...resources.map((resource) => h(ResourceCard, {
          key: resource.id,
          resource,
          ...actions,
        }))),
  );
}

export function LibraryHome({
  resources,
  onCreateBulletin,
  onStartBlank,
  onOpen,
  onDuplicate,
  onShowAll,
}: LibraryHomeProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () => resources.filter((resource) => !resource.archived && matches(resource, deferredQuery)),
    [resources, deferredQuery],
  );
  const bulletins = visible.filter((resource) => resource.kind === "bulletin");
  const current = bulletins.slice(0, 1);
  const recent = bulletins.slice(1, 7);
  const templates = visible.filter((resource) => resource.kind === "template").slice(0, 6);
  const libraryIsEmpty = resources.length === 0;

  const actions = {
    onOpen,
    ...(onDuplicate === undefined ? {} : { onDuplicate }),
  };

  return h(
    "div",
    null,
    h(PageHeader, {
      title: "This Week",
      description: "Continue the current bulletin or start the next one from a trusted template.",
      actions: onCreateBulletin === undefined
        ? undefined
        : libraryIsEmpty
          ? h("div", { className: "cbb-stack" },
              h("div", { className: "cbb-cluster" },
                h(Button, { variant: "primary", onClick: onCreateBulletin }, "Use a starter"),
                onStartBlank === undefined ? null : h(Button, { onClick: onStartBlank }, "Start blank"),
                h(Button, {
                  disabled: true,
                  "aria-describedby": `${searchId}-import-help`,
                }, "Import bulletin or template"),
              ),
              h("span", { id: `${searchId}-import-help`, className: "cbb-field__hint" },
                "Import is not available in this version. Existing files are not claimed as supported.",
              ),
            )
          : h(Button, { variant: "primary", onClick: onCreateBulletin }, "Create This Week’s Bulletin"),
    }),
    h("div", { className: "cbb-field" },
      h("label", { htmlFor: searchId }, "Search your bulletin library"),
      h("input", {
        id: searchId,
        className: "cbb-search",
        type: "search",
        value: query,
        placeholder: "Search names, dates, and status",
        onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
      }),
    ),
    query.length > 0
      ? h(LibrarySection, {
          title: "Search results",
          emptyText: "No bulletin, template, or saved section matches every search word.",
          resources: visible,
          ...actions,
        })
      : h("div", null,
          h(LibrarySection, { title: "This Week", emptyText: "No bulletin is underway yet. Use a starter to make one.", resources: current, ...actions }),
          h(LibrarySection, { title: "Recent Bulletins", emptyText: "Recently opened bulletins will appear here.", resources: recent, ...actions }),
          h(LibrarySection, { title: "Templates", emptyText: "Templates saved for reuse will appear here.", resources: templates, ...actions }),
        ),
    onShowAll === undefined ? null : h(Button, { onClick: onShowAll }, "Show all bulletins"),
  );
}

export const librarySearch = matches;
