import { useId, useMemo } from "react";
import {
  canonicalRevisionToken,
  type AuthoringPolicy,
  type CbbDocument,
  type ContentRule,
  type FieldDefinition,
  type NativeElement,
} from "@cbb/core";
import { Banner, Button } from "../design-system/index.js";
import { trapModalTab, useModalFocus } from "./modalFocus.js";

export interface SourceTemplateChangeGroup {
  readonly title: string;
  readonly changes: readonly string[];
}

interface NamedValue {
  readonly key: string;
  readonly name: string;
  readonly value: unknown;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalRevisionToken({ value: left ?? null }) ===
    canonicalRevisionToken({ value: right ?? null });
}

function changedNamedValues(
  before: readonly NamedValue[],
  after: readonly NamedValue[],
  noun: string,
): readonly string[] {
  const beforeMap = new Map(before.map((item) => [item.key, item]));
  const afterMap = new Map(after.map((item) => [item.key, item]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  return keys.flatMap((key) => {
    const previous = beforeMap.get(key);
    const next = afterMap.get(key);
    const name = next?.name ?? previous?.name ?? "Unnamed item";
    if (previous === undefined) return [`Added ${noun} “${name}”.`];
    if (next === undefined) return [`Removed ${noun} “${name}”.`];
    return same(previous.value, next.value)
      ? []
      : [`Changed ${noun} “${name}”.`];
  });
}

function fieldShape(field: FieldDefinition): unknown {
  const { default: _default, examples: _examples, ...shape } = field;
  return shape;
}

function namedFields(document: CbbDocument): readonly NamedValue[] {
  const values: NamedValue[] = (document.fieldContract?.fields ?? []).map((field) => ({
    key: `document:${field.id}`,
    name: field.label,
    value: fieldShape(field),
  }));
  for (const definition of document.customElementDefinitions ?? []) {
    values.push(...definition.fieldContract.fields.map((field) => ({
      key: `${definition.id}:${field.id}`,
      name: `${definition.name} / ${field.label}`,
      value: fieldShape(field),
    })));
  }
  return values;
}

function namedGroups(document: CbbDocument): readonly NamedValue[] {
  const values: NamedValue[] = (document.fieldContract?.groups ?? []).map((group) => ({
    key: `document:${group.id}`,
    name: group.label,
    value: group,
  }));
  for (const definition of document.customElementDefinitions ?? []) {
    values.push(...(definition.fieldContract.groups ?? []).map((group) => ({
      key: `${definition.id}:${group.id}`,
      name: `${definition.name} / ${group.label}`,
      value: group,
    })));
  }
  return values;
}

function namedDefaults(document: CbbDocument): readonly NamedValue[] {
  const values: NamedValue[] = [];
  const add = (
    ownerKey: string,
    prefix: string,
    fields: readonly FieldDefinition[],
    samples: CbbDocument["sampleFieldValues"],
  ) => {
    for (const field of fields) {
      values.push({
        key: `${ownerKey}:${field.id}`,
        name: `${prefix}${field.label}`,
        value: {
          default: field.default ?? null,
          examples: field.examples ?? null,
          sample: samples?.[field.id] ?? null,
        },
      });
    }
  };
  add("document", "", document.fieldContract?.fields ?? [], document.sampleFieldValues);
  for (const definition of document.customElementDefinitions ?? []) {
    add(definition.id, `${definition.name} / `, definition.fieldContract.fields, definition.sampleFieldValues);
  }
  return values;
}

function ruleName(rule: ContentRule): string {
  return rule.kind === "conditional"
    ? `Show section: ${rule.activateLabel}`
    : `Repeat section: ${rule.itemLabel}`;
}

function namedRules(document: CbbDocument): readonly NamedValue[] {
  const values: NamedValue[] = (document.contentRules ?? []).map((rule) => ({
    key: `document:${rule.id}`,
    name: ruleName(rule),
    value: rule,
  }));
  for (const definition of document.customElementDefinitions ?? []) {
    values.push(...(definition.contentRules ?? []).map((rule) => ({
      key: `${definition.id}:${rule.id}`,
      name: `${definition.name} / ${ruleName(rule)}`,
      value: rule,
    })));
  }
  return values;
}

function addPolicy(
  policies: NamedValue[],
  key: string,
  name: string,
  policy: AuthoringPolicy | undefined,
): void {
  policies.push({ key, name, value: policy ?? null });
}

function collectElementPolicies(
  policies: NamedValue[],
  element: NativeElement,
  path: string,
): void {
  const name = element.name.trim() || `${element.type} item`;
  const current = path.length === 0 ? name : `${path} / ${name}`;
  addPolicy(policies, `element:${element.id}`, current, element.authoringPolicy);
  if (element.type !== "grid" && element.type !== "stack" && element.type !== "canvas") return;
  for (const child of element.children) {
    addPolicy(policies, `placement:${child.id}`, `${current} / placement for ${child.element.name}`, child.authoringPolicy);
    collectElementPolicies(policies, child.element, current);
  }
}

function namedPolicies(document: CbbDocument): readonly NamedValue[] {
  const values: NamedValue[] = [];
  addPolicy(values, "document", "Whole template", document.authoringPolicy);
  for (const element of document.elements) collectElementPolicies(values, element, "Bulletin flow");
  for (const wrapper of document.pageElements ?? []) {
    addPolicy(values, `page-placement:${wrapper.id}`, `Page ${wrapper.purpose} placement`, wrapper.authoringPolicy);
    collectElementPolicies(values, wrapper.element as NativeElement, `Page ${wrapper.purpose}`);
  }
  for (const definition of document.customElementDefinitions ?? []) {
    addPolicy(values, `definition:${definition.id}`, `Saved section ${definition.name}`, definition.authoringPolicy);
    for (const element of definition.elements) {
      collectElementPolicies(values, element, `Saved section ${definition.name}`);
    }
  }
  return values;
}

function stripPolicy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPolicy);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "authoringPolicy")
    .map(([key, child]) => [key, stripPolicy(child)]));
}

function layoutChanges(before: CbbDocument, after: CbbDocument): readonly string[] {
  const sections: readonly NamedValue[] = [
    { key: "page", name: "Page setup", value: before.page },
    { key: "flow", name: "Bulletin flow and content", value: stripPolicy(before.elements) },
    { key: "pageElements", name: "Page-placed content", value: stripPolicy(before.pageElements ?? []) },
    {
      key: "definitions",
      name: "Saved sections and custom elements",
      value: stripPolicy((before.customElementDefinitions ?? []).map((definition) => ({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        elements: definition.elements,
      }))),
    },
  ];
  const next = new Map<string, unknown>([
    ["Page setup", after.page],
    ["Bulletin flow and content", stripPolicy(after.elements)],
    ["Page-placed content", stripPolicy(after.pageElements ?? [])],
    ["Saved sections and custom elements", stripPolicy((after.customElementDefinitions ?? []).map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      elements: definition.elements,
    })))],
  ]);
  return sections.flatMap((section) => same(section.value, next.get(section.name))
    ? []
    : [`Changed ${section.name.toLocaleLowerCase()}.`]);
}

function otherSettings(document: CbbDocument): unknown {
  return {
    metadata: document.metadata ?? null,
    fontFallbackRefs: document.fontFallbackRefs ?? null,
    scripturePresentation: document.scripturePresentation ?? null,
    rightsPolicy: document.rightsPolicy ?? null,
    publicationContexts: document.publicationContexts ?? null,
  };
}

/** A plain-language, exhaustive M4 category review without exposing JSON or ids. */
export function describeSourceTemplateChanges(
  before: CbbDocument,
  after: CbbDocument,
): readonly SourceTemplateChangeGroup[] {
  return Object.freeze([
    { title: "Layout and content", changes: layoutChanges(before, after) },
    {
      title: "Weekly fields and groups",
      changes: [
        ...changedNamedValues(namedGroups(before), namedGroups(after), "field group"),
        ...changedNamedValues(namedFields(before), namedFields(after), "weekly field"),
      ],
    },
    {
      title: "Defaults and test samples",
      changes: changedNamedValues(namedDefaults(before), namedDefaults(after), "default or sample for"),
    },
    {
      title: "Conditional and repeat rules",
      changes: changedNamedValues(namedRules(before), namedRules(after), "rule"),
    },
    {
      title: "Locks and weekly edit policy",
      changes: changedNamedValues(namedPolicies(before), namedPolicies(after), "lock policy for"),
    },
    {
      title: "Template settings",
      changes: same(otherSettings(before), otherSettings(after))
        ? []
        : ["Changed template metadata, Scripture, rights, sharing, or font settings."],
    },
  ]);
}

export interface SourceTemplateUpdateReviewProps {
  readonly source: CbbDocument;
  readonly candidate: CbbDocument;
  readonly sourceChangedSinceBulletinCreation: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function SourceTemplateUpdateReview({
  source,
  candidate,
  sourceChangedSinceBulletinCreation,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: SourceTemplateUpdateReviewProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useModalFocus<HTMLElement>();
  const groups = useMemo(
    () => describeSourceTemplateChanges(source, candidate),
    [candidate, source],
  );
  const changeCount = groups.reduce((total, group) => total + group.changes.length, 0);

  return (
    <div className="cbb-modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="cbb-modal cbb-template-value-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onCancel();
            return;
          }
          trapModalTab(event, dialogRef.current);
        }}
      >
        <div className="cbb-modal__header">
          <div>
            <h2 id={titleId}>Review source template changes</h2>
            <p id={descriptionId}>
              Only the source template gets a new saved revision. This bulletin and every other existing bulletin stay unchanged.
            </p>
          </div>
          <Button autoFocus disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
        {sourceChangedSinceBulletinCreation ? (
          <Banner tone="warning" title="The source template changed after this bulletin was created">
            Review every item carefully. Updating will replace those newer source-template choices with the choices listed here.
          </Banner>
        ) : null}
        <div className="cbb-template-value-list">
          {groups.map((group) => (
            <section key={group.title} className="cbb-template-value-row">
              <h3>{group.title}</h3>
              {group.changes.length === 0 ? (
                <p>No change</p>
              ) : (
                <ul>{group.changes.map((change) => <li key={change}>{change}</li>)}</ul>
              )}
            </section>
          ))}
        </div>
        {error === undefined ? null : <p className="cbb-field-error" role="alert">{error}</p>}
        {changeCount === 0 ? (
          <Banner tone="info" title="The source template already matches">
            There is no reviewed change to save.
          </Banner>
        ) : null}
        <div className="cbb-modal__actions">
          <Button disabled={busy} onClick={onCancel}>Keep editing this bulletin</Button>
          <Button variant="primary" disabled={busy || changeCount === 0} onClick={onConfirm}>
            {busy ? "Updating template…" : "Update template for future bulletins"}
          </Button>
        </div>
      </section>
    </div>
  );
}
