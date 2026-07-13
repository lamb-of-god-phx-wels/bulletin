import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CbbDocument,
  FieldContract,
  FieldDefinition,
  FieldValueEntry,
  IdPort,
  NativeElement,
  NodeId,
  CustomElementInstance,
  ContentRule,
} from "@cbb/core";
import { finalizeCustomDefinitionRevisions, validateFieldValue } from "@cbb/core";
import { Banner, Button } from "../design-system/index.js";
import { EditorWorkspace } from "../editor/index.js";
import {
  conditionalPreviewIsActive,
  createAddCustomInstanceArrayItemCommand,
  createAddDocumentArrayItemCommand,
  createRemoveCustomInstanceArrayItemCommand,
  createRemoveDocumentArrayItemCommand,
  createReorderCustomInstanceArrayItemCommand,
  createReorderDocumentArrayItemCommand,
  createSetCustomInstanceFieldValueCommand,
  createSetDocumentFieldValueCommand,
  createUpdateCustomInstanceArrayItemCommand,
  createUpdateDocumentArrayItemCommand,
  EditorStore,
} from "../store/index.js";
import type { UiSettings } from "../settings/index.js";
import {
  createBulletinFromTemplateDocument,
  hydrateWeeklyWorkflowSandboxSamples,
  localDateOnly,
} from "./documentFactory.js";

export interface WeeklyWorkflowSandboxProps {
  readonly source: CbbDocument;
  readonly settings: UiSettings;
  readonly idPort: IdPort;
  readonly onExit: () => void;
  readonly onApplyAuthoringChanges?: ((document: CbbDocument) => void) | undefined;
  readonly now?: () => Date;
}

const DEFAULT_SANDBOX_NOW = (): Date => new Date();

interface WeeklyFieldBucket {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly conditionalRuleId?: string;
  readonly fields: readonly FieldDefinition[];
}

function weeklyFieldBuckets(contract: FieldContract): readonly WeeklyFieldBucket[] {
  const groups = contract.groups ?? [];
  if (groups.length === 0) {
    return [{
      id: "weekly-fields",
      label: contract.name,
      ...(contract.description === undefined ? {} : { description: contract.description }),
      fields: contract.fields,
    }];
  }
  const knownGroups = new Set(groups.map((group) => group.id));
  const ungrouped = contract.fields.filter(
    (field) => field.groupId === undefined || !knownGroups.has(field.groupId),
  );
  return [
    ...groups.map((group) => ({
      id: group.id,
      label: group.label,
      ...(group.description === undefined ? {} : { description: group.description }),
      ...(group.conditionalRuleId === undefined
        ? {}
        : { conditionalRuleId: group.conditionalRuleId }),
      fields: contract.fields.filter((field) => field.groupId === group.id),
    })),
    ...(ungrouped.length === 0
      ? []
      : [{ id: "other-fields", label: "Other fields", fields: ungrouped }]),
  ];
}

function bucketIsVisible(
  bucket: WeeklyFieldBucket,
  contract: FieldContract,
  values: Readonly<Record<string, FieldValueEntry>> | undefined,
  rules: readonly ContentRule[],
): boolean {
  if (bucket.conditionalRuleId === undefined) return true;
  const rule = rules.find(
    (candidate) => candidate.kind === "conditional" &&
      candidate.id === bucket.conditionalRuleId &&
      candidate.scope === "document",
  );
  if (rule === undefined || rule.kind !== "conditional") return true;
  const field = contract.fields.find(
    (candidate) => candidate.id === rule.fieldId,
  );
  if (field === undefined) return true;
  const value = values?.[field.id]?.value ?? field.default;
  return value !== undefined && conditionalPreviewIsActive(rule, value);
}

function valueLabel(field: FieldDefinition, value: unknown): string {
  if (field.type === "boolean" && typeof value === "boolean") return value ? "Yes" : "No";
  if (field.type === "choice" && typeof value === "string") {
    return field.constraints?.choices?.find((choice) => choice.id === value)?.label ?? value;
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "Configured";
  }
}

function draftValue(field: FieldDefinition, value: unknown): string {
  if ((field.type === "text" || field.type === "date" || field.type === "choice") &&
    typeof value === "string") return value;
  if (field.type === "number" && typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function editorSpecificHelp(field: FieldDefinition): string | undefined {
  switch (field.type) {
    case "richText":
      return "Edit this formatted content directly in the bulletin editor.";
    case "assetRef":
      return "Choose this image with the bulletin editor’s image controls.";
    case "array":
      return undefined;
    case "object":
      return undefined;
    default:
      return undefined;
  }
}

interface SandboxFieldOwner {
  readonly instanceId?: NodeId | undefined;
}

function initialFieldValue(field: FieldDefinition): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "text":
    case "date": return "";
    case "number": return 0;
    case "boolean": return false;
    case "choice": return field.constraints?.choices?.[0]?.id ?? "";
    case "array": return [];
    case "object": return Object.fromEntries((field.childFields ?? []).filter(
      (child) => child.required,
    ).map((child) => [child.id, initialFieldValue(child)]));
    case "richText": return { type: "document", blocks: [{ type: "paragraph", children: [] }] };
    case "assetRef": return "";
  }
}

function StructuredValueEditor(props: {
  readonly field: FieldDefinition;
  readonly value: unknown;
  readonly idPrefix: string;
  readonly onChange: (value: unknown) => void;
}): React.JSX.Element {
  const record = props.value !== null && typeof props.value === "object" && !Array.isArray(props.value)
    ? props.value as Readonly<Record<string, unknown>>
    : {};
  const update = (child: FieldDefinition, value: unknown): void => props.onChange({
    ...record,
    [child.id]: value,
  });
  return (
    <div className="cbb-weekly-structured-item">
      {(props.field.childFields ?? []).map((child) => {
        const id = `${props.idPrefix}-${child.id}`;
        const value = record[child.id] ?? initialFieldValue(child);
        if (child.type === "boolean") {
          return <label key={child.id} className="cbb-weekly-field__checkbox" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(event) => update(child, event.currentTarget.checked)}
            />
            <span>{child.label}{child.required ? " (required)" : ""}</span>
          </label>;
        }
        if (child.type === "choice") {
          return <label key={child.id} htmlFor={id}>
            {child.label}{child.required ? " (required)" : ""}
            <select
              id={id}
              value={typeof value === "string" ? value : ""}
              onChange={(event) => update(child, event.currentTarget.value)}
            >
              {(child.constraints?.choices ?? []).map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>;
        }
        if (child.type === "text" || child.type === "date" || child.type === "number") {
          return <label key={child.id} htmlFor={id}>
            {child.label}{child.required ? " (required)" : ""}
            <input
              id={id}
              type={child.type === "date" ? "date" : child.type === "number" ? "number" : "text"}
              value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
              onChange={(event) => update(
                child,
                child.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
              )}
            />
          </label>;
        }
        return <p key={child.id}>{child.label} is edited directly in the bulletin editor.</p>;
      })}
    </div>
  );
}

function ArrayFieldControl({
  field,
  entry,
  store,
  idPort,
  controlId,
  owner,
  rules,
}: {
  readonly field: FieldDefinition;
  readonly entry: FieldValueEntry | undefined;
  readonly store: EditorStore;
  readonly idPort: IdPort;
  readonly controlId: string;
  readonly owner: SandboxFieldOwner;
  readonly rules: readonly ContentRule[];
}) {
  const source = entry?.value ?? field.default ?? [];
  const values = Array.isArray(source) ? source : [];
  const repeatRule = rules.find(
    (rule) => rule.kind === "repeat" && rule.fieldId === field.id,
  );
  const itemLabel = repeatRule?.kind === "repeat"
    ? repeatRule.itemLabel
    : field.itemField?.label ?? "Item";
  const addLabel = repeatRule?.kind === "repeat"
    ? repeatRule.addLabel
    : `Add ${itemLabel}`;
  const repeatMaximum = repeatRule?.kind === "repeat" ? repeatRule.maxItems : undefined;
  const fieldMaximum = field.constraints?.maxItems;
  const maximum = Math.min(repeatMaximum ?? Infinity, fieldMaximum ?? Infinity);
  const minimum = field.constraints?.minItems ?? 0;
  const reorderable = repeatRule?.kind !== "repeat" || repeatRule.userReorderable;
  const itemField = field.itemField;
  const [newItem, setNewItem] = useState<unknown>(() =>
    itemField === undefined ? "" : initialFieldValue(itemField));
  const [error, setError] = useState("");

  function execute(command: Parameters<EditorStore["execute"]>[0]): boolean {
    try {
      const result = store.execute(command);
      if (result.status === "denied") {
        setError(result.denial.reason);
        return false;
      }
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof Error
        ? failure.message
        : `That ${itemLabel} could not be changed.`);
      return false;
    }
  }

  const addCommand = (value: unknown) => owner.instanceId === undefined
    ? createAddDocumentArrayItemCommand({ fieldId: field.id, value, idPort })
    : createAddCustomInstanceArrayItemCommand({
        instanceId: owner.instanceId,
        fieldId: field.id,
        value,
        idPort,
      });
  const updateCommand = (index: number, value: unknown) => owner.instanceId === undefined
    ? createUpdateDocumentArrayItemCommand({ fieldId: field.id, index, value, idPort })
    : createUpdateCustomInstanceArrayItemCommand({
        instanceId: owner.instanceId,
        fieldId: field.id,
        index,
        value,
        idPort,
      });
  const removeCommand = (index: number) => owner.instanceId === undefined
    ? createRemoveDocumentArrayItemCommand({ fieldId: field.id, index, idPort })
    : createRemoveCustomInstanceArrayItemCommand({
        instanceId: owner.instanceId,
        fieldId: field.id,
        index,
        idPort,
      });
  const reorderCommand = (fromIndex: number, toIndex: number) => owner.instanceId === undefined
    ? createReorderDocumentArrayItemCommand({ fieldId: field.id, fromIndex, toIndex, idPort })
    : createReorderCustomInstanceArrayItemCommand({
        instanceId: owner.instanceId,
        fieldId: field.id,
        fromIndex,
        toIndex,
        idPort,
      });

  if (itemField === undefined) return null;
  return (
    <div className="cbb-weekly-repeat">
      {values.length === 0 ? <p>No {itemLabel.toLocaleLowerCase()} items yet.</p> : (
        <ol aria-label={`${field.label} items`}>
          {values.map((value, index) => {
            const itemId = entry?.itemIds?.[index] ?? `${field.id}-${index}`;
            return (
              <li key={itemId}>
                {itemField.type === "object" ? (
                  <fieldset>
                    <legend>{itemLabel} {index + 1}</legend>
                    <StructuredValueEditor
                      field={itemField}
                      value={value}
                      idPrefix={`${controlId}-${itemId}`}
                      onChange={(next) => execute(updateCommand(index, next))}
                    />
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={`${controlId}-${itemId}`}>{itemLabel} {index + 1}</label>
                    <input
                      id={`${controlId}-${itemId}`}
                      type={itemField.type === "date" ? "date" : itemField.type === "number" ? "number" : "text"}
                      defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                      onBlur={(event) => execute(updateCommand(
                        index,
                        itemField.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
                      ))}
                    />
                  </>
                )}
                <div className="cbb-weekly-repeat__actions">
                  {reorderable ? (
                    <>
                      <Button
                        disabled={index === 0}
                        aria-label={`Move ${itemLabel} ${index + 1} up`}
                        onClick={() => execute(reorderCommand(index, index - 1))}
                      >Up</Button>
                      <Button
                        disabled={index === values.length - 1}
                        aria-label={`Move ${itemLabel} ${index + 1} down`}
                        onClick={() => execute(reorderCommand(index, index + 1))}
                      >Down</Button>
                    </>
                  ) : null}
                  <Button
                    disabled={values.length <= minimum}
                    aria-label={`Remove ${itemLabel} ${index + 1}`}
                    onClick={() => execute(removeCommand(index))}
                  >Remove</Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {itemField.type === "object" ? (
        <fieldset disabled={values.length >= maximum}>
          <legend>New {itemLabel}</legend>
          <StructuredValueEditor
            field={itemField}
            value={newItem}
            idPrefix={`${controlId}-new`}
            onChange={setNewItem}
          />
        </fieldset>
      ) : (
        <>
          <label htmlFor={`${controlId}-new`}>New {itemLabel}</label>
          <input
            id={`${controlId}-new`}
            type={itemField.type === "date" ? "date" : itemField.type === "number" ? "number" : "text"}
            value={typeof newItem === "string" || typeof newItem === "number" ? String(newItem) : ""}
            disabled={values.length >= maximum}
            onChange={(event) => setNewItem(
              itemField.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
            )}
          />
        </>
      )}
      <Button
        disabled={values.length >= maximum || !validateFieldValue(itemField, newItem)}
        onClick={() => {
          if (execute(addCommand(newItem))) setNewItem(initialFieldValue(itemField));
        }}
      >{addLabel}</Button>
      {values.length >= maximum ? (
        <p>This list has reached its maximum of {maximum} items.</p>
      ) : null}
      {error.length === 0 ? null : <p className="cbb-field-error" role="alert">{error}</p>}
    </div>
  );
}

function WeeklyFieldControl({
  field,
  entry,
  store,
  idPort,
  idPrefix,
  owner,
  rules,
  sampleStartingValue,
  contextLabel,
}: {
  readonly field: FieldDefinition;
  readonly entry: FieldValueEntry | undefined;
  readonly store: EditorStore;
  readonly idPort: IdPort;
  readonly idPrefix: string;
  readonly owner: SandboxFieldOwner;
  readonly rules: readonly ContentRule[];
  readonly sampleStartingValue: boolean;
  readonly contextLabel?: string | undefined;
}) {
  const effectiveValue = entry?.value ?? field.default;
  const [draft, setDraft] = useState(() => draftValue(field, effectiveValue));
  const [error, setError] = useState("");
  const controlId = `${idPrefix}-${field.id}`;
  const helpId = `${controlId}-help`;
  const defaultId = `${controlId}-default`;
  const errorId = `${controlId}-error`;
  const editorLabelId = `${controlId}-editor-label`;
  const editorHelpId = `${controlId}-editor-help`;
  const label = `${field.label}${field.required ? " (required)" : " (optional)"}${
    contextLabel === undefined ? "" : ` — ${contextLabel}`
  }`;
  const missingRequired = field.required && entry === undefined && field.default === undefined;
  const fieldError = error || (missingRequired ? "Required value is missing." : "");
  const describedBy = [
    ...(field.description === undefined ? [] : [helpId]),
    ...(field.default === undefined ? [] : [defaultId]),
    ...(fieldError.length === 0 ? [] : [errorId]),
  ].join(" ") || undefined;

  useEffect(() => {
    setDraft(draftValue(field, effectiveValue));
  }, [effectiveValue, field]);

  function write(value: unknown): boolean {
    try {
      const result = store.execute(owner.instanceId === undefined
        ? createSetDocumentFieldValueCommand({ fieldId: field.id, value })
        : createSetCustomInstanceFieldValueCommand({
            instanceId: owner.instanceId,
            fieldId: field.id,
            value,
          }));
      if (result.status === "denied") {
        setError(result.denial.reason);
        return false;
      }
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof Error
        ? failure.message
        : `Enter a valid value for ${field.label}.`);
      return false;
    }
  }

  function writeDraft(next: string, value: unknown): void {
    setDraft(next);
    if (next.length === 0) {
      write(undefined);
      return;
    }
    write(value);
  }

  const specificHelp = editorSpecificHelp(field);
  const arrayField = field.type === "array" && field.itemField !== undefined;
  const structuredField = field.type === "object" && (field.childFields?.length ?? 0) > 0;
  const groupedControl = specificHelp !== undefined || arrayField || structuredField;
  const editorDescribedBy = !groupedControl
    ? undefined
    : ([
        ...(specificHelp === undefined ? [] : [editorHelpId]),
        ...(field.description === undefined ? [] : [helpId]),
        ...(field.default === undefined ? [] : [defaultId]),
        ...(fieldError.length === 0 ? [] : [errorId]),
      ].join(" ") || undefined);
  return (
    <div
      className="cbb-weekly-field"
      data-field-id={field.id}
      {...(!groupedControl
        ? {}
        : {
            role: "group",
            "aria-labelledby": editorLabelId,
            "aria-describedby": editorDescribedBy,
          })}
    >
      {field.type === "boolean" ? (
        <label className="cbb-weekly-field__checkbox" htmlFor={controlId}>
          <input
            id={controlId}
            type="checkbox"
            checked={typeof effectiveValue === "boolean" ? effectiveValue : false}
            aria-describedby={describedBy}
            aria-invalid={fieldError.length > 0}
            onChange={(event) => write(event.currentTarget.checked)}
          />
          <span>{label}</span>
        </label>
      ) : groupedControl ? (
        <h3 id={editorLabelId} className="cbb-weekly-field__label">{label}</h3>
      ) : (
        <label htmlFor={controlId}>{label}</label>
      )}

      {field.type === "text" ? (
        <input
          id={controlId}
          type="text"
          value={draft}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={fieldError.length > 0}
          {...(field.constraints?.minLength === undefined
            ? {}
            : { minLength: field.constraints.minLength })}
          {...(field.constraints?.maxLength === undefined
            ? {}
            : { maxLength: field.constraints.maxLength })}
          {...(field.constraints?.pattern === undefined
            ? {}
            : { pattern: field.constraints.pattern })}
          onChange={(event) => writeDraft(event.currentTarget.value, event.currentTarget.value)}
        />
      ) : field.type === "date" ? (
        <input
          id={controlId}
          type="date"
          value={draft}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={fieldError.length > 0}
          onChange={(event) => writeDraft(event.currentTarget.value, event.currentTarget.value)}
        />
      ) : field.type === "number" ? (
        <input
          id={controlId}
          type="number"
          step="any"
          value={draft}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={fieldError.length > 0}
          {...(field.constraints?.minimum === undefined
            ? {}
            : { min: field.constraints.minimum })}
          {...(field.constraints?.maximum === undefined
            ? {}
            : { max: field.constraints.maximum })}
          onChange={(event) => writeDraft(
            event.currentTarget.value,
            Number(event.currentTarget.value),
          )}
        />
      ) : field.type === "choice" ? (
        <select
          id={controlId}
          value={draft}
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={fieldError.length > 0}
          onChange={(event) => writeDraft(event.currentTarget.value, event.currentTarget.value)}
        >
          <option value="">Choose an option</option>
          {(field.constraints?.choices ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>{choice.label}</option>
          ))}
        </select>
      ) : arrayField ? (
        <ArrayFieldControl
          field={field}
          entry={entry}
          store={store}
          idPort={idPort}
          controlId={controlId}
          owner={owner}
          rules={rules}
        />
      ) : structuredField ? (
        <StructuredValueEditor
          field={field}
          value={effectiveValue ?? initialFieldValue(field)}
          idPrefix={controlId}
          onChange={write}
        />
      ) : specificHelp === undefined ? null : (
        <p id={editorHelpId} className="cbb-weekly-field__editor-help">{specificHelp}</p>
      )}

      {field.description === undefined ? null : (
        <p id={helpId} className="cbb-weekly-field__help">{field.description}</p>
      )}
      {field.default === undefined ? null : (
        <p id={defaultId} className="cbb-weekly-field__default">
          Template default: {valueLabel(field, field.default)}
        </p>
      )}
      {sampleStartingValue ? (
        <p className="cbb-weekly-field__sample">
          Sample/test starting value — disposable preview only
        </p>
      ) : null}
      {fieldError.length === 0 ? null : (
        <p
          id={errorId}
          className="cbb-field-error"
          {...(error.length === 0 ? {} : { role: "alert" })}
        >
          {fieldError}
        </p>
      )}
      {entry === undefined || field.type === "array" ? null : (
        <Button
          variant="quiet"
          onClick={() => {
            if (write(undefined)) setDraft(draftValue(field, field.default));
          }}
        >
          Clear entered value for {field.label}
        </Button>
      )}
    </div>
  );
}

interface WeeklySetupOwner {
  readonly key: string;
  readonly label: string;
  readonly contract: FieldContract;
  readonly values: Readonly<Record<string, FieldValueEntry>> | undefined;
  readonly rules: readonly ContentRule[];
  readonly sampleFieldIds: ReadonlySet<string>;
  readonly instanceId?: NodeId | undefined;
}

function collectCustomInstances(elements: readonly NativeElement[]): readonly CustomElementInstance[] {
  const result: CustomElementInstance[] = [];
  const visit = (element: NativeElement): void => {
    if (element.type === "customInstance") {
      result.push(element);
      return;
    }
    if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
      for (const child of element.children) visit(child.element);
    }
  };
  for (const element of elements) visit(element);
  return result;
}

interface ReachableCustomInstance {
  readonly instance: CustomElementInstance;
  /** A nested instance is one shared value owner in its containing definition. */
  readonly containingDefinitionName?: string | undefined;
}

function reachableCustomInstances(document: CbbDocument): readonly ReachableCustomInstance[] {
  const definitions = new Map(
    (document.customElementDefinitions ?? []).map((definition) => [definition.id, definition]),
  );
  const seenInstances = new Set<NodeId>();
  const result: ReachableCustomInstance[] = [];

  const visitElements = (
    elements: readonly NativeElement[],
    activeDefinitions: ReadonlySet<NodeId>,
    containingDefinitionName?: string,
  ): void => {
    const visit = (element: NativeElement): void => {
      if (element.type === "customInstance") {
        if (!seenInstances.has(element.id)) {
          seenInstances.add(element.id);
          result.push({
            instance: element,
            ...(containingDefinitionName === undefined ? {} : { containingDefinitionName }),
          });
        }
        if (activeDefinitions.has(element.definitionId)) return;
        const definition = definitions.get(element.definitionId);
        if (definition === undefined) return;
        const nextActive = new Set(activeDefinitions);
        nextActive.add(definition.id);
        visitElements(definition.elements, nextActive, definition.name);
        return;
      }
      if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
        for (const wrapper of element.children) visit(wrapper.element);
      }
    };
    for (const element of elements) visit(element);
  };

  visitElements(document.elements, new Set());
  visitElements((document.pageElements ?? []).map((wrapper) => wrapper.element), new Set());
  return result;
}

function weeklySetupOwners(
  document: CbbDocument,
  sampleSource: CbbDocument,
): readonly WeeklySetupOwner[] {
  const owners: WeeklySetupOwner[] = [];
  const sampleDefinitions = new Map(
    (sampleSource.customElementDefinitions ?? []).map((definition) => [definition.id, definition]),
  );
  if (document.fieldContract !== undefined && document.fieldContract.fields.length > 0) {
    owners.push({
      key: "document",
      label: "Bulletin-wide weekly content",
      contract: document.fieldContract,
      values: document.fieldValues,
      rules: document.contentRules ?? [],
      sampleFieldIds: new Set(Object.keys(sampleSource.sampleFieldValues ?? {})),
    });
  }
  for (const reachable of reachableCustomInstances(document)) {
    const { instance } = reachable;
    const definition = document.customElementDefinitions?.find(
      (candidate) => candidate.id === instance.definitionId,
    );
    if (definition === undefined || definition.fieldContract.fields.length === 0) continue;
    owners.push({
      key: instance.id,
      label: `Saved section: ${instance.name}${reachable.containingDefinitionName === undefined
        ? ""
        : ` — shared inside ${reachable.containingDefinitionName}`}`,
      contract: definition.fieldContract,
      values: instance.fieldValues,
      rules: definition.contentRules ?? [],
      sampleFieldIds: new Set(Object.keys(
        sampleDefinitions.get(definition.id)?.sampleFieldValues ?? {},
      )),
      instanceId: instance.id,
    });
  }
  return owners;
}

function WeeklySetupForm({
  store,
  idPort,
  sampleSource,
}: {
  readonly store: EditorStore;
  readonly idPort: IdPort;
  readonly sampleSource: CbbDocument;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const headingId = useId();
  const idPrefix = useId();
  const owners = weeklySetupOwners(snapshot.document, sampleSource);
  if (owners.length === 0) {
    return (
      <section className="cbb-weekly-setup" aria-labelledby={headingId}>
        <h2 id={headingId}>Weekly setup form</h2>
        <p>This template has no weekly fields to fill.</p>
      </section>
    );
  }
  return (
    <section className="cbb-weekly-setup" aria-labelledby={headingId}>
      <h2 id={headingId}>Weekly setup form</h2>
      <p>Try the values a volunteer would enter. The bulletin preview updates immediately.</p>
      <form onSubmit={(event) => event.preventDefault()}>
        {owners.map((owner) => {
          const buckets = weeklyFieldBuckets(owner.contract).filter(
            (bucket) => bucketIsVisible(bucket, owner.contract, owner.values, owner.rules),
          );
          return (
            <section key={owner.key} className="cbb-weekly-owner" aria-labelledby={`${idPrefix}-${owner.key}-heading`}>
              <h3 id={`${idPrefix}-${owner.key}-heading`}>{owner.label}</h3>
              {buckets.map((bucket) => (
                <fieldset key={`${owner.key}-${bucket.id}`}>
                  <legend>{bucket.label}</legend>
                  {bucket.description === undefined ? null : <p>{bucket.description}</p>}
                  {bucket.fields.length === 0 ? (
                    <p>No weekly fields are assigned to this group.</p>
                  ) : bucket.fields.map((field) => (
                    <WeeklyFieldControl
                      key={field.id}
                      field={field}
                      entry={owner.values?.[field.id]}
                      store={store}
                      idPort={idPort}
                      idPrefix={`${idPrefix}-${owner.key}`}
                      owner={owner.instanceId === undefined ? {} : { instanceId: owner.instanceId }}
                      rules={owner.rules}
                      sampleStartingValue={owner.sampleFieldIds.has(field.id)}
                      {...(owner.instanceId === undefined ? {} : { contextLabel: owner.label })}
                    />
                  ))}
                </fieldset>
              ))}
            </section>
          );
        })}
      </form>
    </section>
  );
}

function SandboxEditor({
  source,
  settings,
  idPort,
  resetToken,
  now,
  onSandboxDocumentChange,
}: Omit<WeeklyWorkflowSandboxProps, "onExit" | "onApplyAuthoringChanges"> & {
  readonly resetToken: number;
  readonly onSandboxDocumentChange: (document: CbbDocument) => void;
}) {
  const document = useMemo(() => hydrateWeeklyWorkflowSandboxSamples(
    source,
    createBulletinFromTemplateDocument(source, {
      idPort,
      publicationDate: localDateOnly(now?.() ?? new Date()),
      displayName: `${source.name} — disposable weekly test`,
    }),
  ), [idPort, now, resetToken, source]);
  const store = useMemo(() => new EditorStore(document), [document]);

  useEffect(() => {
    onSandboxDocumentChange(store.getSnapshot().document);
    return store.subscribeToDocumentChanges((event) => onSandboxDocumentChange(event.document));
  }, [onSandboxDocumentChange, store]);

  return (
    <div className="cbb-weekly-test__workspace">
      <WeeklySetupForm store={store} idPort={idPort} sampleSource={source} />
      <EditorWorkspace
        store={store}
        idPort={idPort}
        initialView={settings.viewMode}
        initialPagePresentation={settings.pagePresentation}
        initialMarginGuides={settings.marginGuides}
        initialSnapping={settings.canvasSnap}
        spellcheckEnabled={settings.offlineSpellcheck}
        confirmEnterCustomize={() => true}
      />
    </div>
  );
}

function persistedCustomInstances(document: CbbDocument): readonly CustomElementInstance[] {
  return [
    ...collectCustomInstances(document.elements),
    ...(document.pageElements ?? []).flatMap((wrapper) =>
      collectCustomInstances([wrapper.element])),
    ...(document.customElementDefinitions ?? []).flatMap((definition) =>
      collectCustomInstances(definition.elements)),
  ];
}

function customInstancesById(document: CbbDocument): ReadonlyMap<NodeId, CustomElementInstance> {
  return new Map(persistedCustomInstances(document).map((instance) => [instance.id, instance]));
}

function restoreCustomInstanceTestValues(
  elements: readonly NativeElement[],
  sourceInstances: ReadonlyMap<NodeId, CustomElementInstance>,
): readonly NativeElement[] {
  const restore = (element: NativeElement): NativeElement => {
    if (element.type === "customInstance") {
      const source = sourceInstances.get(element.id);
      const { fieldValues: _testValues, ...authored } = element;
      return source?.fieldValues === undefined
        ? authored
        : { ...authored, fieldValues: source.fieldValues };
    }
    if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
      return {
        ...element,
        children: element.children.map((wrapper) => ({
          ...wrapper,
          element: restore(wrapper.element),
        })),
      } as NativeElement;
    }
    return element;
  };
  return elements.map(restore);
}

/** Build the only document that may leave the disposable sandbox. */
export function reviewedSandboxAuthoringDocument(
  source: CbbDocument,
  sandbox: CbbDocument,
): CbbDocument {
  const {
    kind: _sandboxKind,
    name: _sandboxName,
    metadata: _sandboxMetadata,
    fieldValues: _testFieldValues,
    fieldReview: _testFieldReview,
    contentReview: _testContentReview,
    sourceTemplate: _testSourceTemplate,
    orphanedFieldValues: _testOrphans,
    sampleFieldValues: _testSamples,
    elements,
    pageElements,
    customElementDefinitions,
    ...authoring
  } = sandbox;
  const sourceInstances = customInstancesById(source);
  const restoredDefinitions = (customElementDefinitions ?? []).map((definition) => ({
    ...definition,
    elements: restoreCustomInstanceTestValues(definition.elements, sourceInstances),
  }));
  const restoredElements = restoreCustomInstanceTestValues(elements, sourceInstances);
  const restoredPageElements = pageElements?.map((wrapper) => ({
    ...wrapper,
    element: restoreCustomInstanceTestValues(
      [wrapper.element],
      sourceInstances,
    )[0] as typeof wrapper.element,
  }));
  const pinned = finalizeCustomDefinitionRevisions({
    definitions: source.customElementDefinitions ?? [],
    elements: source.elements,
    ...(source.pageElements === undefined ? {} : { pageElements: source.pageElements }),
  }, {
    definitions: restoredDefinitions,
    elements: restoredElements,
    ...(restoredPageElements === undefined ? {} : { pageElements: restoredPageElements }),
  });
  return {
    ...authoring,
    kind: source.kind,
    name: source.name,
    ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
    elements: pinned.elements,
    ...(pinned.pageElements === undefined ? {} : { pageElements: pinned.pageElements }),
    ...(customElementDefinitions === undefined
      ? {}
      : { customElementDefinitions: pinned.definitions }),
    ...(source.sampleFieldValues === undefined
      ? {}
      : { sampleFieldValues: source.sampleFieldValues }),
    ...(source.fieldValues === undefined ? {} : { fieldValues: source.fieldValues }),
    ...(source.fieldReview === undefined ? {} : { fieldReview: source.fieldReview }),
    ...(source.contentReview === undefined ? {} : { contentReview: source.contentReview }),
    ...(source.sourceTemplate === undefined ? {} : { sourceTemplate: source.sourceTemplate }),
    ...(source.orphanedFieldValues === undefined
      ? {}
      : { orphanedFieldValues: source.orphanedFieldValues }),
  };
}

const AUTHORING_CHANGE_LABELS: Readonly<Record<string, string>> = {
  page: "Page setup",
  authoringPolicy: "Document protection",
  fontFallbackRefs: "Fonts",
  scripturePresentation: "Scripture formatting",
  rightsPolicy: "Rights policy",
  publicationContexts: "Sharing choices",
  fieldContract: "Weekly fields and defaults",
  contentRules: "Conditional and repeated sections",
  elements: "Layout and content structure",
  pageElements: "Page backgrounds, headers, or footers",
  sampleFieldValues: "Sample/test preview values",
  customElementDefinitions: "Saved Sections",
};

function authoringChangeLabels(source: CbbDocument, reviewed: CbbDocument): readonly string[] {
  const keys = new Set([...Object.keys(source), ...Object.keys(reviewed)]);
  return [...keys].flatMap((key) => {
    if (["kind", "name", "metadata", "fieldValues", "fieldReview", "contentReview", "sourceTemplate", "orphanedFieldValues"].includes(key)) {
      return [];
    }
    const left = (source as unknown as Readonly<Record<string, unknown>>)[key];
    const right = (reviewed as unknown as Readonly<Record<string, unknown>>)[key];
    return JSON.stringify(left) === JSON.stringify(right)
      ? []
      : [AUTHORING_CHANGE_LABELS[key] ?? "Template settings"];
  });
}

/**
 * In-memory volunteer workflow test. It intentionally receives no renderer
 * bridge or autosave port, so test values cannot appear in the normal library.
 */
export function WeeklyWorkflowSandbox({
  source,
  settings,
  idPort,
  onExit,
  onApplyAuthoringChanges,
  now = DEFAULT_SANDBOX_NOW,
}: WeeklyWorkflowSandboxProps) {
  const [resetToken, setResetToken] = useState(0);
  const [sandboxDocument, setSandboxDocument] = useState(source);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewed = useMemo(
    () => reviewedSandboxAuthoringDocument(source, sandboxDocument),
    [sandboxDocument, source],
  );
  const changes = useMemo(() => authoringChangeLabels(source, reviewed), [reviewed, source]);
  return (
    <div className="cbb-theme cbb-document-page cbb-weekly-test" data-cbb-theme={settings.theme}>
      <header className="cbb-document-header">
        <div className="cbb-document-header__identity">
          <span className="cbb-document-header__brand">Disposable test</span>
          <h1>Test weekly workflow</h1>
        </div>
        <div className="cbb-document-header__actions">
          <Button onClick={() => {
            setReviewOpen(false);
            setResetToken((value) => value + 1);
          }}>Reset test values</Button>
          <Button
            disabled={onApplyAuthoringChanges === undefined || changes.length === 0}
            onClick={() => setReviewOpen(true)}
          >Review authoring changes</Button>
          <Button variant="primary" onClick={onExit}>Exit test</Button>
        </div>
      </header>
      <Banner tone="info" title="Test mode — changes are discarded">
        Try the Weekly Content form, optional sections, repeated items, and layout protection. This test never creates a bulletin in your library.
      </Banner>
      {reviewOpen ? (
        <section className="cbb-weekly-apply-review" role="dialog" aria-modal="false" aria-labelledby="weekly-apply-review-heading">
          <h2 id="weekly-apply-review-heading">Review authoring changes</h2>
          <p>Only these template-authoring changes can be applied. Test bulletin values and review state are always excluded.</p>
          <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>
          <div className="cbb-document-header__actions">
            <Button onClick={() => setReviewOpen(false)}>Keep testing</Button>
            <Button variant="primary" onClick={() => {
              onApplyAuthoringChanges?.(reviewed);
              setReviewOpen(false);
            }}>Apply changes to template</Button>
          </div>
        </section>
      ) : null}
      <SandboxEditor
        key={resetToken}
        source={source}
        settings={settings}
        idPort={idPort}
        resetToken={resetToken}
        now={now}
        onSandboxDocumentChange={setSandboxDocument}
      />
    </div>
  );
}
