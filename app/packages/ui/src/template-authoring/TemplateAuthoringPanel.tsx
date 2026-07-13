import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  CHURCH_PROFILE_ASSET_FIELD_KEYS,
  CHURCH_PROFILE_TEXT_FIELD_KEYS,
  collectAllNodeIds,
  type CbbDocument,
  type ConditionalRule,
  type ContentRule,
  type FieldContractGroup,
  type FieldDefinition,
  type FieldType,
  type IdPort,
  type NativeElement,
  type NodeId,
  type RepeatRule,
} from "@cbb/core";
import { Banner, Button, LiveRegion } from "../design-system/index.js";
import { TASK_LANGUAGE } from "../language/index.js";
import {
  authorableElements,
  bindableProperties,
  createAddConditionalRuleCommand,
  createAddRepeatRuleCommand,
  createAddWeeklyFieldCommand,
  createAddWeeklyFieldGroupCommand,
  createAssignWeeklyFieldGroupCommand,
  createDuplicateSavedSectionCommand,
  createInsertSavedSectionCommand,
  createLinkWeeklyFieldCommand,
  createMakeIndependentCommand,
  createMakeSavedSectionIndependentCommand,
  createMakeWeeklyFieldCommand,
  createRemoveContentRuleCommand,
  createRemoveSavedSectionCommand,
  createRemoveWeeklyFieldCommand,
  createRemoveWeeklyFieldGroupCommand,
  createRenameSavedSectionCommand,
  createReorderWeeklyFieldCommand,
  createReorderWeeklyFieldGroupCommand,
  createSaveAsSavedSectionCommand,
  createSetUnboundContentReviewCommand,
  createSetWeeklyFieldProfileMappingCommand,
  createSetWeeklyFieldSampleValueCommand,
  createUpdateContentRuleCommand,
  createUpdateWeeklyFieldCommand,
  createUpdateWeeklyFieldGroupCommand,
  fieldOwnerContract,
  fieldOwnerRules,
  findElementLocation,
  templateAuthoringDiagnostics,
  type BindableProperty,
  type ChurchProfileFieldKey,
  type TemplateFieldOwner,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorCommand, EditorMode, ExecuteCommandResult } from "../store/types.js";
import "./template-authoring.css";

type AuthoringTab = "fields" | "rules" | "savedSections" | "template";

export interface TemplateAuthoringPanelProps {
  readonly document: CbbDocument;
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly selectedNodeId?: NodeId | undefined;
  readonly idPort: IdPort;
  readonly onAnnouncement?: ((message: string) => void) | undefined;
  readonly confirmAction?: ((message: string) => boolean) | undefined;
  /** Workspace-level lifecycle operations remain outside document undo. */
  readonly onSaveAsTemplate?: ((document: CbbDocument) => void) | undefined;
  readonly onDuplicateTemplate?: ((document: CbbDocument) => void) | undefined;
  readonly onTestWeeklyWorkflow?: ((document: CbbDocument) => void) | undefined;
  readonly onOpenSourceTemplate?: (() => void) | undefined;
  readonly onChangeOnlyThisBulletin?: (() => void) | undefined;
  readonly onUpdateTemplateForFutureBulletins?: ((document: CbbDocument) => void) | undefined;
}

interface FieldDraft {
  readonly label: string;
  readonly type: FieldType;
  readonly description: string;
  readonly required: boolean;
  readonly choices: string;
  readonly defaultValue: string;
  readonly rolloverPolicy: "clear" | "keep" | "ask" | "deriveConfirm";
  readonly reviewExpectation: "everyBulletin" | "whenCarried" | "none";
  readonly groupId: string;
  readonly profileKey: ChurchProfileFieldKey | "";
  readonly arrayMaximum: string;
  readonly arrayItemMode: "text" | "structured";
  readonly structuredItemFields: readonly StructuredItemFieldDraft[];
}

interface StructuredItemFieldDraft {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "date" | "number" | "boolean";
  readonly required: boolean;
}

interface ConnectionOption {
  readonly key: string;
  readonly nodeId: NodeId;
  readonly nodeName: string;
  readonly property: BindableProperty;
  readonly binding?: NonNullable<Exclude<NativeElement, { type: "customInstance" }>["bindings"]>[number];
}

interface FieldBucket {
  readonly id: string;
  readonly label: string;
  readonly group?: FieldContractGroup;
  readonly fields: readonly FieldDefinition[];
}

const TABS: readonly { readonly id: AuthoringTab; readonly label: string }[] = [
  { id: "fields", label: "Weekly fields" },
  { id: "rules", label: "Section rules" },
  { id: "savedSections", label: TASK_LANGUAGE.savedSections },
  { id: "template", label: "Template actions" },
];

const FIELD_TYPE_LABELS: Readonly<Record<FieldType, string>> = {
  text: "Short text",
  richText: "Formatted text",
  date: "Date",
  number: "Number",
  boolean: "Yes or no",
  choice: "Choice list",
  assetRef: "Image",
  array: "Repeatable list",
  object: "Group of values",
};

const AUTHORABLE_FIELD_TYPES: readonly FieldType[] = [
  "text",
  "richText",
  "date",
  "number",
  "boolean",
  "choice",
  "assetRef",
  "array",
];

function emptyFieldDraft(): FieldDraft {
  return {
    label: "",
    type: "text",
    description: "",
    required: false,
    choices: "",
    defaultValue: "",
    rolloverPolicy: "clear",
    reviewExpectation: "everyBulletin",
    groupId: "",
    profileKey: "",
    arrayMaximum: "20",
    arrayItemMode: "text",
    structuredItemFields: [{ key: "item-title", label: "Title", type: "text", required: true }],
  };
}

function draftFromField(field: FieldDefinition): FieldDraft {
  const choices = field.constraints?.choices?.map((choice) => choice.label).join("\n") ?? "";
  const defaultValue = field.default === undefined
    ? ""
    : typeof field.default === "boolean"
      ? String(field.default)
      : typeof field.default === "string" || typeof field.default === "number"
        ? String(field.default)
        : "";
  return {
    label: field.label,
    type: field.type,
    description: field.description ?? "",
    required: field.required,
    choices,
    defaultValue,
    rolloverPolicy: field.weeklyBehavior?.rolloverPolicy ?? "clear",
    reviewExpectation: field.weeklyBehavior?.reviewExpectation ?? "everyBulletin",
    groupId: field.groupId ?? "",
    profileKey: field.profileKey ?? "",
    arrayMaximum: String(field.constraints?.maxItems ?? 20),
    arrayItemMode: field.type === "array" && field.itemField?.type === "object"
      ? "structured"
      : "text",
    structuredItemFields: field.type === "array" && field.itemField?.type === "object"
      ? (field.itemField.childFields ?? []).flatMap((child) =>
          child.type === "text" || child.type === "date" || child.type === "number" || child.type === "boolean"
            ? [{
                key: child.id,
                label: child.label,
                type: child.type,
                required: child.required,
              }]
            : [])
      : [{ key: `${field.id}-item-title`, label: "Title", type: "text", required: true }],
  };
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "weekly-field";
}

function uniqueFieldId(label: string, fields: readonly FieldDefinition[]): string {
  const used = new Set(fields.map((field) => field.id));
  const base = slug(label);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function uniqueGroupId(
  label: string,
  groups: readonly FieldContractGroup[],
): string {
  const used = new Set(groups.map((group) => group.id));
  const base = slug(label);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

const CHURCH_PROFILE_LABELS: Readonly<Record<ChurchProfileFieldKey, string>> = {
  churchName: "Church name",
  mailingAddress: "Mailing address",
  locationAddress: "Location address",
  phone: "Phone",
  email: "Email",
  website: "Website",
  defaultServiceLabel: "Default service label",
  logo: "Logo",
};

function churchProfileOptions(field: FieldDefinition): readonly {
  readonly value: ChurchProfileFieldKey;
  readonly label: string;
}[] {
  const keys: readonly ChurchProfileFieldKey[] = field.type === "text"
    ? CHURCH_PROFILE_TEXT_FIELD_KEYS
    : field.type === "assetRef"
      ? CHURCH_PROFILE_ASSET_FIELD_KEYS
      : [];
  return keys.map((value) => ({ value, label: CHURCH_PROFILE_LABELS[value] }));
}

function churchProfileOptionsForType(type: FieldType) {
  const keys: readonly ChurchProfileFieldKey[] = type === "text"
    ? CHURCH_PROFILE_TEXT_FIELD_KEYS
    : type === "assetRef"
      ? CHURCH_PROFILE_ASSET_FIELD_KEYS
      : [];
  return keys.map((value) => ({ value, label: CHURCH_PROFILE_LABELS[value] }));
}

function choiceEntries(
  value: string,
  original: NonNullable<NonNullable<FieldDefinition["constraints"]>["choices"]> = [],
) {
  const labels = value
    .split(/\r?\n/u)
    .map((label) => label.trim())
    .filter(Boolean);
  const choices = original ?? [];
  const used = new Set<string>();
  const assigned: ({ readonly id: string; readonly label: string } | undefined)[] =
    labels.map(() => undefined);

  // Preserve identity across pure reordering before considering positional
  // renames. Conditional rules, defaults, and stored values use these ids.
  for (const [index, label] of labels.entries()) {
    const exact = choices.find((choice) => choice.label === label && !used.has(choice.id));
    if (exact === undefined) continue;
    assigned[index] = { id: exact.id, label };
    used.add(exact.id);
  }
  // Pair the remaining rows in order. This treats a changed label as a rename
  // even when unchanged choices were reordered around it.
  const remainingOriginal = choices.filter((choice) => !used.has(choice.id));
  let remainingIndex = 0;
  for (const [index, label] of labels.entries()) {
    if (assigned[index] !== undefined) continue;
    const prior = remainingOriginal[remainingIndex++];
    if (prior === undefined) continue;
    assigned[index] = { id: prior.id, label };
    used.add(prior.id);
  }
  return assigned.map((entry, index) => {
    if (entry !== undefined) return entry;
    const label = labels[index] as string;
      const base = slug(label);
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id);
      return { id, label };
  });
}

function fieldFromDraft(
  draft: FieldDraft,
  id: string,
  original?: FieldDefinition,
): FieldDefinition {
  const {
    description: _originalDescription,
    default: _originalDefault,
    groupId: _originalGroupId,
    profileKey: _originalProfileKey,
    constraints: originalConstraints,
    itemField: _originalItemField,
    ...preservedOriginal
  } = original ?? {};
  void _originalDescription;
  void _originalDefault;
  void _originalGroupId;
  void _originalProfileKey;
  void _originalItemField;
  const choices = draft.type === "choice"
    ? choiceEntries(draft.choices, original?.constraints?.choices)
    : undefined;
  let parsedDefault: unknown;
  if (draft.defaultValue.trim() !== "") {
    if (draft.type === "number") parsedDefault = Number(draft.defaultValue);
    else if (draft.type === "boolean") parsedDefault = draft.defaultValue === "true";
    else if (draft.type !== "richText" && draft.type !== "array") {
      parsedDefault = draft.type === "choice"
        ? choices?.find((choice) => choice.label === draft.defaultValue)?.id ?? draft.defaultValue
        : draft.defaultValue;
    }
  }
  return {
    ...preservedOriginal,
    id,
    label: draft.label.trim(),
    type: original?.type ?? draft.type,
    required: draft.required,
    ...(draft.groupId === "" ? {} : { groupId: draft.groupId }),
    ...(draft.profileKey === "" ? {} : { profileKey: draft.profileKey }),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.type === "choice"
      ? { constraints: { ...(originalConstraints ?? {}), choices: choices ?? [] } }
      : draft.type === "array"
        ? {}
        : originalConstraints === undefined ? {} : { constraints: originalConstraints }),
    ...(parsedDefault === undefined ? {} : { default: parsedDefault }),
    weeklyBehavior: {
      rolloverPolicy: draft.rolloverPolicy,
      reviewExpectation: draft.reviewExpectation,
      ...(draft.rolloverPolicy === "deriveConfirm"
        ? { derivation: { kind: "nextScheduledServiceDate" as const } }
        : {}),
    },
    ...(draft.type === "array"
      ? {
          itemField: draft.arrayItemMode === "structured"
            ? {
                id: original?.itemField?.id ?? `${id}-item`,
                label: original?.itemField?.label ?? "Item",
                type: "object" as const,
                required: true,
                childFields: draft.structuredItemFields.map((child, index) => ({
                  id: child.key.trim() || `${id}-item-${index + 1}`,
                  label: child.label.trim(),
                  type: child.type,
                  required: child.required,
                })),
              }
            : {
                id: original?.itemField?.type === "text"
                  ? original.itemField.id
                  : `${id}-item`,
                label: original?.itemField?.type === "text"
                  ? original.itemField.label
                  : "Item",
                type: "text" as const,
                required: true,
              },
          constraints: {
            ...(originalConstraints ?? {}),
            maxItems: Number(draft.arrayMaximum),
          },
        }
      : {}),
  };
}

function ownerKey(owner: TemplateFieldOwner): string {
  return owner.kind === "document" ? "document" : `saved:${owner.definitionId}`;
}

function ownerFromKey(document: CbbDocument, value: string): TemplateFieldOwner {
  if (value === "document") return { kind: "document" };
  const definitionId = value.startsWith("saved:") ? value.slice("saved:".length) : "";
  return document.customElementDefinitions?.some((definition) => definition.id === definitionId)
    ? { kind: "savedSection", definitionId }
    : { kind: "document" };
}

function mintNodeId(document: CbbDocument, idPort: IdPort): NodeId {
  const used = collectAllNodeIds(document);
  for (;;) {
    const candidate = `n${idPort.randomUuid().replaceAll("-", "")}`;
    if (!used.has(candidate)) return candidate;
  }
}

function resultMessage(result: ExecuteCommandResult, success: string): string {
  if (result.status === "applied") return success;
  if (result.status === "noChange") return "Nothing changed.";
  return result.denial.reason;
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : "That change could not be completed.";
}

function FieldGroupForm(props: {
  readonly initial?: FieldContractGroup | undefined;
  readonly conditionalRules: readonly ConditionalRule[];
  readonly fields: readonly FieldDefinition[];
  readonly onSubmit: (value: {
    readonly label: string;
    readonly description: string;
    readonly conditionalRuleId: string;
  }) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [label, setLabel] = useState(props.initial?.label ?? "");
  const [description, setDescription] = useState(props.initial?.description ?? "");
  const [conditionalRuleId, setConditionalRuleId] = useState(
    props.initial?.conditionalRuleId ?? "",
  );
  const [preview, setPreview] = useState<"active" | "inactive">("active");
  const [previewSeen, setPreviewSeen] = useState<ReadonlySet<"active" | "inactive">>(
    () => conditionalRuleId === "" ? new Set(["active", "inactive"]) : new Set(["active"]),
  );
  const selectedRule = props.conditionalRules.find((rule) => rule.id === conditionalRuleId);
  const selectedField = props.fields.find((field) => field.id === selectedRule?.fieldId);
  return (
    <form
      className="cbb-template-form cbb-template-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({ label, description, conditionalRuleId });
      }}
    >
      <h4>{props.initial === undefined ? "Add a setup-form group" : `Rename ${props.initial.label}`}</h4>
      <label>
        Group name
        <input
          required
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </label>
      <label>
        Group help text (optional)
        <input
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <label className="cbb-template-span">
        Show this section when
        <select
          value={conditionalRuleId}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setConditionalRuleId(value);
            setPreview("active");
            setPreviewSeen(value === ""
              ? new Set(["active", "inactive"])
              : new Set(["active"]));
          }}
        >
          <option value="">Always show this setup section</option>
          {props.conditionalRules.map((rule) => {
            const field = props.fields.find((candidate) => candidate.id === rule.fieldId);
            return (
              <option key={rule.id} value={rule.id}>
                {field?.label ?? "Missing weekly field"}: {rule.activateLabel}
              </option>
            );
          })}
        </select>
      </label>
      {selectedRule === undefined ? null : (
        <fieldset className="cbb-template-preview cbb-template-span">
          <legend>Preview setup-section visibility</legend>
          <label><input
            type="radio"
            name="group-visibility-preview"
            checked={preview === "active"}
            onChange={() => {
              setPreview("active");
              setPreviewSeen((seen) => new Set([...seen, "active"]));
            }}
          /> Active</label>
          <label><input
            type="radio"
            name="group-visibility-preview"
            checked={preview === "inactive"}
            onChange={() => {
              setPreview("inactive");
              setPreviewSeen((seen) => new Set([...seen, "inactive"]));
            }}
          /> Inactive</label>
          <p>{preview === "active"
            ? `“${label || "This section"}” is shown after ${selectedField?.label ?? "the weekly choice"}.`
            : `“${label || "This section"}” stays hidden.`}</p>
          <p role="status">{previewSeen.size < 2
            ? "Preview both states to enable saving."
            : "Both setup-section states reviewed."}</p>
        </fieldset>
      )}
      <div className="cbb-template-form-actions cbb-template-span">
        <Button variant="primary" type="submit" disabled={previewSeen.size < 2}>
          {props.initial === undefined ? "Add group" : "Save group changes"}
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function WeeklyFieldForm(props: {
  readonly initial?: FieldDefinition | undefined;
  readonly initialDraft?: FieldDraft | undefined;
  readonly groups: readonly FieldContractGroup[];
  readonly heading?: string | undefined;
  readonly submitLabel?: string | undefined;
  readonly onSubmit: (draft: FieldDraft) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<FieldDraft>(() =>
    props.initialDraft ?? (props.initial === undefined ? emptyFieldDraft() : draftFromField(props.initial)));
  const update = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const profileOptions = churchProfileOptionsForType(draft.type);
  const updateStructuredItem = (
    index: number,
    updateValue: Partial<StructuredItemFieldDraft>,
  ): void => {
    setDraft((current) => ({
      ...current,
      structuredItemFields: current.structuredItemFields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...updateValue } : field),
    }));
  };
  return (
    <form
      className="cbb-template-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit(draft);
      }}
    >
      <h4>{props.heading ?? (props.initial === undefined ? "Add a weekly field" : `Edit ${props.initial.label}`)}</h4>
      <label>
        Field name
        <input
          required
          value={draft.label}
          onChange={(event) => update("label", event.currentTarget.value)}
        />
      </label>
      <label>
        What volunteers enter
        <select
          value={draft.type}
          disabled={props.initial !== undefined}
          onChange={(event) => {
            const type = event.currentTarget.value as FieldType;
            setDraft((current) => ({ ...current, type, profileKey: "" }));
          }}
        >
          {AUTHORABLE_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>
          ))}
        </select>
      </label>
      <label className="cbb-template-span">
        Help text
        <textarea
          rows={2}
          value={draft.description}
          onChange={(event) => update("description", event.currentTarget.value)}
        />
      </label>
      {draft.type === "choice" ? (
        <label className="cbb-template-span">
          Choices, one per line
          <textarea
            required
            rows={4}
            value={draft.choices}
            onChange={(event) => update("choices", event.currentTarget.value)}
          />
        </label>
      ) : null}
      {draft.type !== "richText" && draft.type !== "array" ? (
        <label>
          Template default (optional)
          {draft.type === "boolean" ? (
            <select
              value={draft.defaultValue}
              onChange={(event) => update("defaultValue", event.currentTarget.value)}
            >
              <option value="">No default</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              type={draft.type === "number" ? "number" : draft.type === "date" ? "date" : "text"}
              value={draft.defaultValue}
              onChange={(event) => update("defaultValue", event.currentTarget.value)}
            />
          )}
        </label>
      ) : null}
      <label>
        Setup-form group
        <select value={draft.groupId} onChange={(event) => update("groupId", event.currentTarget.value)}>
          <option value="">Other fields</option>
          {props.groups.map((group) => (
            <option key={group.id} value={group.id}>{group.label}</option>
          ))}
        </select>
      </label>
      <label>
        Church Profile suggestion (optional)
        <select
          disabled={profileOptions.length === 0}
          value={profileOptions.some((option) => option.value === draft.profileKey)
            ? draft.profileKey
            : ""}
          onChange={(event) => update(
            "profileKey",
            event.currentTarget.value as ChurchProfileFieldKey | "",
          )}
        >
          <option value="">{profileOptions.length === 0 ? "Not compatible" : "Do not offer a profile value"}</option>
          {profileOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {draft.type === "array" ? (
        <fieldset className="cbb-template-span cbb-template-repeat-fields">
          <legend>What each repeated item contains</legend>
          <label>
            Item fields
            <select
              value={draft.arrayItemMode}
              disabled={props.initial !== undefined}
              onChange={(event) => update(
                "arrayItemMode",
                event.currentTarget.value as FieldDraft["arrayItemMode"],
              )}
            >
              <option value="text">One text value</option>
              <option value="structured">Several named values</option>
            </select>
          </label>
          <label>
            Maximum items
            <input
              required
              type="number"
              min="1"
              max="1000"
              value={draft.arrayMaximum}
              onChange={(event) => update("arrayMaximum", event.currentTarget.value)}
            />
          </label>
          {draft.arrayItemMode === "structured" ? (
            <div className="cbb-template-structured-fields cbb-template-span">
              <p>Define the plain-language fields volunteers fill for each item.</p>
              {draft.structuredItemFields.map((field, index) => (
                <fieldset key={field.key}>
                  <legend>Item field {index + 1}</legend>
                  <label>
                    Field name
                    <input
                      required
                      value={field.label}
                      onChange={(event) => updateStructuredItem(index, {
                        label: event.currentTarget.value,
                        key: `${slug(event.currentTarget.value)}-${index + 1}`,
                      })}
                    />
                  </label>
                  <label>
                    Value type
                    <select
                      value={field.type}
                      onChange={(event) => updateStructuredItem(index, {
                        type: event.currentTarget.value as StructuredItemFieldDraft["type"],
                      })}
                    >
                      <option value="text">Short text</option>
                      <option value="date">Date</option>
                      <option value="number">Number</option>
                      <option value="boolean">Yes or no</option>
                    </select>
                  </label>
                  <label className="cbb-template-checkbox">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => updateStructuredItem(index, {
                        required: event.currentTarget.checked,
                      })}
                    />
                    Required for each item
                  </label>
                  <Button
                    variant="danger"
                    disabled={draft.structuredItemFields.length === 1}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      structuredItemFields: current.structuredItemFields.filter(
                        (_candidate, candidateIndex) => candidateIndex !== index,
                      ),
                    }))}
                  >Remove item field</Button>
                </fieldset>
              ))}
              <Button onClick={() => setDraft((current) => ({
                ...current,
                structuredItemFields: [
                  ...current.structuredItemFields,
                  {
                    key: `item-field-${current.structuredItemFields.length + 1}`,
                    label: "",
                    type: "text",
                    required: false,
                  },
                ],
              }))}>Add item field</Button>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      <label>
        Next week
        <select
          value={draft.rolloverPolicy}
          onChange={(event) => update(
            "rolloverPolicy",
            event.currentTarget.value as FieldDraft["rolloverPolicy"],
          )}
        >
          <option value="clear">Start empty</option>
          <option value="keep">Keep the prior value</option>
          <option value="ask">Ask whether to keep it</option>
          {draft.type === "date" ? <option value="deriveConfirm">Suggest the next service date</option> : null}
        </select>
      </label>
      <label>
        Weekly review
        <select
          value={draft.reviewExpectation}
          onChange={(event) => update(
            "reviewExpectation",
            event.currentTarget.value as FieldDraft["reviewExpectation"],
          )}
        >
          <option value="everyBulletin">Review every bulletin</option>
          <option value="whenCarried">Review when carried forward</option>
          <option value="none">No weekly reminder</option>
        </select>
      </label>
      <label className="cbb-template-checkbox cbb-template-span">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(event) => update("required", event.currentTarget.checked)}
        />
        Required before creating the PDF
      </label>
      <div className="cbb-template-form-actions cbb-template-span">
        <Button variant="primary" type="submit">
          {props.submitLabel ?? (props.initial === undefined ? "Add weekly field" : "Save field changes")}
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function sampleDraft(field: FieldDefinition, value: unknown): string {
  if (field.type === "boolean" && typeof value === "boolean") return String(value);
  if (field.type === "array" && field.itemField?.type === "text" && Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("\n");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function SampleValueControl(props: {
  readonly field: FieldDefinition;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onCommit: (value: unknown) => void;
  readonly onClear: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(() => sampleDraft(props.field, props.value));
  const supported = props.field.type === "text" || props.field.type === "date" ||
    props.field.type === "number" || props.field.type === "boolean" ||
    props.field.type === "choice" ||
    (props.field.type === "array" && props.field.itemField?.type === "text");
  const commit = (): void => {
    if (props.field.type === "number") props.onCommit(Number(draft));
    else if (props.field.type === "boolean") props.onCommit(draft === "true");
    else if (props.field.type === "array") {
      props.onCommit(draft.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean));
    } else props.onCommit(draft);
  };
  return (
    <div className="cbb-template-sample cbb-template-span">
      <strong>Sample/test value — preview only</strong>
      <p>This is visibly separate from the template default and is discarded from real bulletins.</p>
      {supported ? (
        <label>
          Sample/test value for {props.field.label}
          {props.field.type === "boolean" ? (
            <select value={draft} disabled={props.disabled} onChange={(event) => setDraft(event.currentTarget.value)}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          ) : props.field.type === "choice" ? (
            <select value={draft} disabled={props.disabled} onChange={(event) => setDraft(event.currentTarget.value)}>
              <option value="">Choose a sample</option>
              {props.field.constraints?.choices?.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          ) : props.field.type === "array" ? (
            <textarea
              rows={3}
              value={draft}
              disabled={props.disabled}
              placeholder="One sample item per line"
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          ) : (
            <input
              type={props.field.type === "date" ? "date" : props.field.type === "number" ? "number" : "text"}
              value={draft}
              disabled={props.disabled}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          )}
        </label>
      ) : (
        <p>Use Test weekly workflow to try this formatted, image, or structured value safely.</p>
      )}
      <div className="cbb-template-row-actions">
        {supported ? <Button disabled={props.disabled} onClick={commit}>Save sample/test value</Button> : null}
        {props.value === undefined ? null : (
          <Button variant="quiet" disabled={props.disabled} onClick={props.onClear}>
            Clear sample/test value
          </Button>
        )}
      </div>
    </div>
  );
}

function RuleSummary(props: {
  readonly rule: ContentRule;
  readonly field?: FieldDefinition | undefined;
  readonly node?: NativeElement | undefined;
}): React.JSX.Element {
  if (props.rule.kind === "repeat") {
    return (
      <>
        <strong>{props.node?.name ?? "Repeated section"}</strong>
        <span>{props.field?.label ?? "Missing weekly field"} · maximum {props.rule.maxItems}</span>
      </>
    );
  }
  const condition = props.rule.condition.kind === "booleanEquals"
    ? props.rule.condition.value ? "is Yes" : "is No"
    : props.rule.condition.kind === "choiceEquals" ? "matches a choice" : "does not match a choice";
  return (
    <>
      <strong>{props.node?.name ?? "Optional section"}</strong>
      <span>{props.field?.label ?? "Missing weekly field"} {condition}</span>
    </>
  );
}

function ownerLabel(document: CbbDocument, owner: TemplateFieldOwner): string {
  if (owner.kind === "document") return "This bulletin or template";
  return document.customElementDefinitions?.find((definition) => definition.id === owner.definitionId)?.name ?? "Saved section";
}

function sourceContains(element: NativeElement, nodeId: NodeId): boolean {
  return element.id === nodeId || (
    (element.type === "grid" || element.type === "stack" || element.type === "canvas") &&
    element.children.some((wrapper) => sourceContains(wrapper.element, nodeId))
  );
}

interface RepeatItemLeaf {
  readonly path: string;
  readonly field: FieldDefinition;
}

function pointerFieldSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function repeatItemLeaves(field: FieldDefinition | undefined): readonly RepeatItemLeaf[] {
  if (field === undefined) return [];
  if (field.type !== "object") return [{ path: "", field }];
  return (field.childFields ?? []).flatMap((child) =>
    child.type === "object" || child.type === "array"
      ? []
      : [{ path: `/${pointerFieldSegment(child.id)}`, field: child }]);
}

export function TemplateAuthoringPanel(props: TemplateAuthoringPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<AuthoringTab>("fields");
  const [selectedOwnerKey, setSelectedOwnerKey] = useState("document");
  const [addingField, setAddingField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string>();
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const [connectionKey, setConnectionKey] = useState("");
  const [connectionFieldId, setConnectionFieldId] = useState("");
  const [makingConnection, setMakingConnection] = useState(false);
  const [ruleEditor, setRuleEditor] = useState<"conditional" | "repeat">("conditional");
  const [editingRuleId, setEditingRuleId] = useState<string>();
  const [conditionalTarget, setConditionalTarget] = useState("");
  const [conditionalFieldId, setConditionalFieldId] = useState("");
  const [conditionMode, setConditionMode] = useState<"equals" | "notEquals">("equals");
  const [conditionValue, setConditionValue] = useState("true");
  const [activeLabel, setActiveLabel] = useState("Include section");
  const [inactiveLabel, setInactiveLabel] = useState("Leave section out");
  const [conditionalPreview, setConditionalPreview] = useState<"active" | "inactive">("active");
  const [conditionalPreviewSeen, setConditionalPreviewSeen] = useState<ReadonlySet<"active" | "inactive">>(
    () => new Set(["active"]),
  );
  const [repeatPrototype, setRepeatPrototype] = useState("");
  const [repeatFieldId, setRepeatFieldId] = useState("");
  const [repeatMaximum, setRepeatMaximum] = useState("10");
  const [repeatItemLabel, setRepeatItemLabel] = useState("Item");
  const [repeatAddLabel, setRepeatAddLabel] = useState("Add item");
  const [repeatReorderable, setRepeatReorderable] = useState(true);
  const [repeatEmptyMode, setRepeatEmptyMode] = useState<"collapse" | "show">("collapse");
  const [repeatEmptyNode, setRepeatEmptyNode] = useState("");
  const [repeatItemConnections, setRepeatItemConnections] = useState<Readonly<Record<string, string>>>({});
  const [repeatPreview, setRepeatPreview] = useState<"items" | "empty">("items");
  const [repeatPreviewSeen, setRepeatPreviewSeen] = useState<ReadonlySet<"items" | "empty">>(
    () => new Set(["items"]),
  );
  const [savedName, setSavedName] = useState("");
  const [savedDescription, setSavedDescription] = useState("");
  const [renamingDefinitionId, setRenamingDefinitionId] = useState<string>();
  const [renamedSavedSection, setRenamedSavedSection] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");

  const owner = useMemo(
    () => ownerFromKey(props.document, selectedOwnerKey),
    [props.document, selectedOwnerKey],
  );
  const contract = fieldOwnerContract(props.document, owner);
  const rules = fieldOwnerRules(props.document, owner);
  const elements = authorableElements(props.document, owner);
  const fields = contract?.fields ?? [];
  const groups = contract?.groups ?? [];
  const sampleValues = owner.kind === "document"
    ? props.document.sampleFieldValues
    : props.document.customElementDefinitions?.find(
        (definition) => definition.id === owner.definitionId,
      )?.sampleFieldValues;
  const editableField = fields.find((field) => field.id === editingFieldId);
  const editableGroup = groups.find((group) => group.id === editingGroupId);
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const ungroupedFields = fields.filter(
    (field) => field.groupId === undefined || !knownGroupIds.has(field.groupId),
  );
  const fieldBuckets: readonly FieldBucket[] = [
    ...groups.map((group) => ({
      id: group.id,
      label: group.label,
      group,
      fields: fields.filter((field) => field.groupId === group.id),
    })),
    ...(ungroupedFields.length === 0
      ? []
      : [{ id: "ungrouped", label: "Other fields", fields: ungroupedFields }]),
  ];
  const conditionalFields = fields.filter((field) => field.type === "boolean" || field.type === "choice");
  const repeatFields = fields.filter((field) => field.type === "array" && field.itemField !== undefined);
  const editable = props.mode === "customizeLayout";
  const diagnostics = useMemo(
    () => templateAuthoringDiagnostics(props.document, owner),
    [owner, props.document],
  );
  const unboundReviewElements = elements.filter((element) =>
    element.type !== "customInstance" &&
    (element.bindings?.length ?? 0) === 0 &&
    bindableProperties(element).length > 0
  );

  useEffect(() => {
    if (ownerKey(owner) !== selectedOwnerKey) setSelectedOwnerKey(ownerKey(owner));
  }, [owner, selectedOwnerKey]);

  useEffect(() => {
    setAddingGroup(false);
    setEditingGroupId(undefined);
  }, [selectedOwnerKey]);

  const connections = useMemo<readonly ConnectionOption[]>(() => {
    const result: ConnectionOption[] = [];
    for (const element of elements) {
      if (element.type === "customInstance") continue;
      for (const property of bindableProperties(element)) {
        const binding = element.bindings?.find((candidate) => candidate.target === property.target);
        result.push({
          key: `${element.id}:${property.target}`,
          nodeId: element.id,
          nodeName: element.name,
          property,
          ...(binding === undefined ? {} : { binding }),
        });
      }
    }
    return result;
  }, [elements]);
  const selectedConnection = connections.find((connection) => connection.key === connectionKey)
    ?? connections.find((connection) => connection.nodeId === props.selectedNodeId && connection.binding === undefined)
    ?? connections.find((connection) => connection.binding === undefined);
  const compatibleFields = selectedConnection === undefined
    ? []
    : fields.filter((field) => selectedConnection.property.acceptedTypes.includes(field.type));
  const connectionFieldDraft = useMemo<FieldDraft | undefined>(() => {
    if (selectedConnection === undefined) return undefined;
    const type = selectedConnection.property.acceptedTypes[0] ?? "text";
    return {
      ...emptyFieldDraft(),
      label: `${selectedConnection.nodeName} ${selectedConnection.property.label}`,
      type,
      arrayItemMode: "text",
    };
  }, [selectedConnection]);

  const editingRule = rules.find((rule) => rule.id === editingRuleId);
  const selectedConditionalField = conditionalFields.find((field) => field.id === conditionalFieldId);
  const selectedRepeatField = repeatFields.find((field) => field.id === repeatFieldId);
  const selectedRepeatItemLeaves = repeatItemLeaves(selectedRepeatField?.itemField);
  const repeatConnectionOptions = useMemo<Readonly<Record<string, readonly ConnectionOption[]>>>(() => {
    const prototype = elements.find((element) => element.id === repeatPrototype);
    if (prototype === undefined) return {};
    const options: Record<string, ConnectionOption[]> = {};
    for (const leaf of repeatItemLeaves(selectedRepeatField?.itemField)) {
      const leafOptions: ConnectionOption[] = [];
      for (const element of elements) {
        if (!sourceContains(prototype, element.id) || element.type === "customInstance") continue;
        for (const property of bindableProperties(element)) {
          if (!property.acceptedTypes.includes(leaf.field.type)) continue;
          leafOptions.push({
            key: `${element.id}:${property.target}`,
            nodeId: element.id,
            nodeName: element.name,
            property,
          });
        }
      }
      options[leaf.path] = leafOptions;
    }
    return options;
  }, [elements, repeatPrototype, selectedRepeatField]);

  const announce = (message: string): void => {
    setAnnouncement(message);
    props.onAnnouncement?.(message);
  };

  const execute = (command: EditorCommand, success: string): boolean => {
    setError("");
    try {
      const result = props.store.execute(command);
      const message = resultMessage(result, success);
      announce(message);
      if (result.status === "denied") setError(message);
      return result.status === "applied";
    } catch (cause) {
      const message = displayError(cause);
      setError(message);
      announce(message);
      return false;
    }
  };

  const confirm = (message: string): boolean => {
    if (props.confirmAction !== undefined) return props.confirmAction(message);
    return typeof window === "undefined" ? false : window.confirm(message);
  };

  const submitField = (draft: FieldDraft): void => {
    const existing = editableField;
    const fieldId = existing?.id ?? uniqueFieldId(draft.label, fields);
    const nextField = fieldFromDraft(draft, fieldId, existing);
    const command = existing === undefined
      ? createAddWeeklyFieldCommand({
          owner,
          field: nextField,
          contractId: props.idPort.randomUuid(),
          contractName: `${ownerLabel(props.document, owner)} weekly fields`,
        })
      : createUpdateWeeklyFieldCommand({ owner, fieldId: existing.id, field: nextField });
    if (execute(command, existing === undefined
      ? `Added weekly field “${nextField.label}”.`
      : `Updated weekly field “${nextField.label}”.`)) {
      setAddingField(false);
      setEditingFieldId(undefined);
    }
  };

  const submitConnectionField = (draft: FieldDraft): void => {
    if (selectedConnection === undefined) {
      setError("Choose visible content to connect.");
      return;
    }
    const fieldId = uniqueFieldId(draft.label, fields);
    const field = fieldFromDraft(draft, fieldId);
    if (execute(createMakeWeeklyFieldCommand({
      owner,
      nodeId: selectedConnection.nodeId,
      fieldId,
      field,
      contractId: props.idPort.randomUuid(),
      contractName: `${ownerLabel(props.document, owner)} weekly fields`,
      target: selectedConnection.property.target,
      bindingId: `connection-${props.idPort.randomUuid()}`,
      ...(selectedConnection.property.currentValue === undefined
        ? {}
        : { fallback: selectedConnection.property.currentValue }),
    }), `Created and connected weekly field “${field.label}”.`)) {
      setMakingConnection(false);
    }
  };

  const submitGroup = (draft: {
    readonly label: string;
    readonly description: string;
    readonly conditionalRuleId: string;
  }): void => {
    const label = draft.label.trim();
    const description = draft.description.trim();
    const existing = editableGroup;
    const group: FieldContractGroup = {
      id: existing?.id ?? uniqueGroupId(label, groups),
      label,
      ...(description.length === 0 ? {} : { description }),
      ...(draft.conditionalRuleId === ""
        ? {}
        : { conditionalRuleId: draft.conditionalRuleId }),
    };
    const command = existing === undefined
      ? createAddWeeklyFieldGroupCommand({
          owner,
          group,
          contractId: props.idPort.randomUuid(),
          contractName: `${ownerLabel(props.document, owner)} weekly fields`,
        })
      : createUpdateWeeklyFieldGroupCommand({
          owner,
          groupId: existing.id,
          group,
        });
    if (execute(
      command,
      existing === undefined
        ? `Added setup-form group “${group.label}”.`
        : `Updated setup-form group “${group.label}”.`,
    )) {
      setAddingGroup(false);
      setEditingGroupId(undefined);
    }
  };

  const beginEditConditional = (rule: ConditionalRule): void => {
    setRuleEditor("conditional");
    setEditingRuleId(rule.id);
    setConditionalTarget(rule.targetNodeId);
    setConditionalFieldId(rule.fieldId);
    if (rule.condition.kind === "booleanEquals") {
      setConditionMode("equals");
      setConditionValue(String(rule.condition.value));
    } else {
      setConditionMode(rule.condition.kind === "choiceEquals" ? "equals" : "notEquals");
      setConditionValue(rule.condition.choiceId);
    }
    setActiveLabel(rule.activateLabel);
    setInactiveLabel(rule.inactiveLabel);
    setConditionalPreview("active");
    setConditionalPreviewSeen(new Set(["active"]));
  };

  const beginEditRepeat = (rule: RepeatRule): void => {
    setRuleEditor("repeat");
    setEditingRuleId(rule.id);
    setRepeatPrototype(rule.prototypeNodeId);
    setRepeatFieldId(rule.fieldId);
    setRepeatMaximum(String(rule.maxItems));
    setRepeatItemLabel(rule.itemLabel);
    setRepeatAddLabel(rule.addLabel);
    setRepeatReorderable(rule.userReorderable);
    setRepeatEmptyMode(rule.emptyState.mode);
    setRepeatEmptyNode(rule.emptyState.mode === "show" ? rule.emptyState.nodeId : "");
    setRepeatItemConnections(Object.fromEntries((rule.itemBindings ?? []).map((binding) => [
      binding.itemPath,
      `${binding.targetNodeId}:${binding.target}`,
    ])));
    setRepeatPreview("items");
    setRepeatPreviewSeen(new Set(["items"]));
  };

  const submitConditional = (event: FormEvent): void => {
    event.preventDefault();
    if (conditionalPreviewSeen.size < 2) {
      setError("Preview both the active and inactive optional-section states before saving.");
      return;
    }
    const field = conditionalFields.find((candidate) => candidate.id === conditionalFieldId);
    if (field === undefined) {
      setError("Choose a Yes/No or choice weekly field.");
      return;
    }
    const condition = field.type === "boolean"
      ? { kind: "booleanEquals" as const, value: conditionValue === "true" }
      : conditionMode === "equals"
        ? { kind: "choiceEquals" as const, choiceId: conditionValue }
        : { kind: "choiceNotEquals" as const, choiceId: conditionValue };
    const prior = editingRule?.kind === "conditional" ? editingRule : undefined;
    const next: ConditionalRule = {
      kind: "conditional",
      id: prior?.id ?? `optional-${props.idPort.randomUuid()}`,
      targetNodeId: conditionalTarget,
      scope: "document",
      fieldId: field.id,
      condition,
      activateLabel: activeLabel.trim() || "Include section",
      inactiveLabel: inactiveLabel.trim() || "Leave section out",
    };
    const command = prior === undefined
      ? createAddConditionalRuleCommand({ owner, ...next, ruleId: next.id })
      : createUpdateContentRuleCommand({ owner, rule: next });
    if (execute(command, prior === undefined ? "Added optional-section rule." : "Updated optional-section rule.")) {
      setEditingRuleId(undefined);
      setConditionalPreview("active");
      setConditionalPreviewSeen(new Set(["active"]));
    }
  };

  const submitRepeat = (event: FormEvent): void => {
    event.preventDefault();
    if (repeatPreviewSeen.size < 2) {
      setError("Preview both the with-items and empty repeated-section states before saving.");
      return;
    }
    const prior = editingRule?.kind === "repeat" ? editingRule : undefined;
    const emptyState: RepeatRule["emptyState"] = repeatEmptyMode === "collapse"
      ? { mode: "collapse" }
      : { mode: "show", nodeId: repeatEmptyNode };
    const itemBindings = selectedRepeatItemLeaves.flatMap((leaf) => {
      const selected = repeatConnectionOptions[leaf.path]?.find(
        (connection) => connection.key === repeatItemConnections[leaf.path],
      );
      if (selected === undefined) return [];
      const priorBinding = prior?.itemBindings?.find(
        (binding) => binding.itemPath === leaf.path,
      );
      return [{
        id: priorBinding?.id ?? `item-connection-${props.idPort.randomUuid()}`,
        itemPath: leaf.path,
        targetNodeId: selected.nodeId,
        target: selected.property.target,
      }];
    });
    const next: RepeatRule = {
      kind: "repeat",
      id: prior?.id ?? `repeat-${props.idPort.randomUuid()}`,
      fieldId: repeatFieldId,
      prototypeNodeId: repeatPrototype,
      ...(itemBindings.length === 0 ? {} : { itemBindings }),
      emptyState,
      maxItems: Number(repeatMaximum),
      userReorderable: repeatReorderable,
      itemLabel: repeatItemLabel.trim() || "Item",
      addLabel: repeatAddLabel.trim() || "Add item",
    };
    const command = prior === undefined
      ? createAddRepeatRuleCommand({
          owner,
          ...next,
          ruleId: next.id,
          ...(itemBindings.length === 0 ? {} : { itemBindings }),
        })
      : createUpdateContentRuleCommand({ owner, rule: next });
    if (execute(command, prior === undefined ? "Added repeated-section rule." : "Updated repeated-section rule.")) {
      setEditingRuleId(undefined);
      setRepeatPreview("items");
      setRepeatPreviewSeen(new Set(["items"]));
    }
  };

  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((entry) => entry.id === tab);
    const index = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[index] as (typeof TABS)[number];
    setTab(next.id);
    document.getElementById(`template-tab-${next.id}`)?.focus();
  };

  return (
    <section className="cbb-template-authoring" aria-labelledby="template-authoring-heading">
      <header className="cbb-template-header">
        <div>
          <h2 id="template-authoring-heading">Template authoring</h2>
          <p>Choose what changes each week, when sections appear, and what can be reused.</p>
        </div>
      </header>

      {editable ? null : (
        <Banner title="Open Customize Layout" tone="info">
          Weekly fields, section rules, and Saved Sections can only be designed in Customize Layout.
        </Banner>
      )}
      {error ? <div className="cbb-template-error" role="alert">{error}</div> : null}
      <LiveRegion message={announcement} />

      <div className="cbb-template-tabs" role="tablist" aria-label="Template authoring tools" onKeyDown={handleTabKeys}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`template-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`template-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "template" ? null : (
        <label className="cbb-template-owner">
          Design for
          <select
            value={ownerKey(owner)}
            onChange={(event) => {
              setSelectedOwnerKey(event.currentTarget.value);
              setEditingFieldId(undefined);
              setEditingRuleId(undefined);
            }}
          >
            <option value="document">This bulletin or template</option>
            {(props.document.customElementDefinitions ?? []).map((definition) => (
              <option key={definition.id} value={`saved:${definition.id}`}>
                Saved section: {definition.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        id="template-panel-fields"
        role="tabpanel"
        aria-labelledby="template-tab-fields"
        hidden={tab !== "fields"}
        className="cbb-template-panel"
      >
        <div className="cbb-template-section-heading">
          <div>
            <h3>Weekly setup fields</h3>
            <p>These become the simple setup form volunteers fill out each week.</p>
          </div>
          <Button
            variant="primary"
            disabled={!editable}
            onClick={() => {
              setAddingField(true);
              setEditingFieldId(undefined);
            }}
          >Add weekly field</Button>
        </div>

        <section className="cbb-template-subsection" aria-labelledby="template-checks-heading">
          <h3 id="template-checks-heading">Template checks</h3>
          {diagnostics.length === 0 ? (
            <p className="cbb-template-empty">All weekly fields and section connections are in use.</p>
          ) : (
            <ul className="cbb-template-diagnostics" aria-label="Template connection checks">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${diagnostic.fieldId ?? diagnostic.nodeId ?? index}`}>
                  <strong>{diagnostic.severity === "error" ? "Fix connection" : "Review field"}</strong>
                  <span>{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="cbb-template-subsection cbb-template-group-designer"
          aria-labelledby="setup-form-groups-heading"
        >
          <div className="cbb-template-section-heading">
            <div>
              <h3 id="setup-form-groups-heading">Setup-form groups</h3>
              <p>Arrange related questions into the order volunteers will see them.</p>
            </div>
            <Button
              disabled={!editable}
              onClick={() => {
                setAddingGroup(true);
                setEditingGroupId(undefined);
              }}
            >Add setup-form group</Button>
          </div>

          {groups.length === 0 ? (
            <p className="cbb-template-empty">No groups yet. Fields appear together under Other fields.</p>
          ) : (
            <ol className="cbb-template-list cbb-template-group-list" aria-label="Setup-form groups">
              {groups.map((group, index) => (
                <li key={group.id}>
                  <div>
                    <strong>{group.label}</strong>
                    {group.description ? <small>{group.description}</small> : null}
                    {group.conditionalRuleId === undefined ? null : (
                      <span>
                        Show this section when: {
                          fields.find((field) => field.id === rules.find(
                            (rule) => rule.kind === "conditional" && rule.id === group.conditionalRuleId,
                          )?.fieldId)?.label ?? "rule needs review"
                        }
                      </span>
                    )}
                    <span>{fields.filter((field) => field.groupId === group.id).length} fields</span>
                  </div>
                  <div className="cbb-template-row-actions">
                    <Button
                      aria-label={`Move ${group.label} group up`}
                      disabled={!editable || index === 0}
                      onClick={() => execute(createReorderWeeklyFieldGroupCommand({
                        owner,
                        groupId: group.id,
                        toIndex: index - 1,
                      }), `Moved setup-form group “${group.label}” up.`)}
                    >Up</Button>
                    <Button
                      aria-label={`Move ${group.label} group down`}
                      disabled={!editable || index === groups.length - 1}
                      onClick={() => execute(createReorderWeeklyFieldGroupCommand({
                        owner,
                        groupId: group.id,
                        toIndex: index + 1,
                      }), `Moved setup-form group “${group.label}” down.`)}
                    >Down</Button>
                    <Button
                      aria-label={`Rename ${group.label} group`}
                      disabled={!editable}
                      onClick={() => {
                        setAddingGroup(false);
                        setEditingGroupId(group.id);
                      }}
                    >Rename</Button>
                    <Button
                      aria-label={`Remove ${group.label} group`}
                      variant="danger"
                      disabled={!editable}
                      onClick={() => {
                        if (!confirm(`Remove group “${group.label}”? Its fields will move to Other fields.`)) return;
                        execute(createRemoveWeeklyFieldGroupCommand({
                          owner,
                          groupId: group.id,
                        }), `Removed setup-form group “${group.label}”.`);
                      }}
                    >Remove</Button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {addingGroup || editableGroup !== undefined ? (
            <FieldGroupForm
              key={editableGroup?.id ?? `new-group-${ownerKey(owner)}`}
              initial={editableGroup}
              conditionalRules={rules.filter(
                (rule): rule is ConditionalRule => rule.kind === "conditional" && rule.scope === "document",
              )}
              fields={fields}
              onSubmit={submitGroup}
              onCancel={() => {
                setAddingGroup(false);
                setEditingGroupId(undefined);
              }}
            />
          ) : null}
        </section>

        {fields.length === 0 ? (
          <p className="cbb-template-empty">No weekly fields yet. Add one for content that changes from service to service.</p>
        ) : (
          <div className="cbb-template-field-buckets">
            {fieldBuckets.map((bucket) => (
              <section key={bucket.id} className="cbb-template-field-bucket">
                <h4>{bucket.label}</h4>
                {bucket.fields.length === 0 ? (
                  <p className="cbb-template-empty">No weekly fields in this group.</p>
                ) : (
                  <ul
                    className="cbb-template-list"
                    aria-label={bucket.group === undefined
                      ? "Weekly fields"
                      : `${bucket.group.label} weekly fields`}
                  >
                    {bucket.fields.map((field, fieldIndex) => {
                      const prior = bucket.fields[fieldIndex - 1];
                      const next = bucket.fields[fieldIndex + 1];
                      const selectedGroup = knownGroupIds.has(field.groupId ?? "")
                        ? field.groupId
                        : undefined;
                      const profileOptions = churchProfileOptions(field);
                      const selectedProfileKey = profileOptions.find(
                        (option) => option.value === field.profileKey,
                      )?.value;
                      return (
                        <li key={field.id} className="cbb-template-field-row">
                          <div className="cbb-template-field-summary">
                            <strong>{field.label}</strong>
                            <span>{FIELD_TYPE_LABELS[field.type]}{field.required ? " · required" : ""}</span>
                            {field.description ? <small>{field.description}</small> : null}
                            <div className="cbb-template-field-controls">
                              <label>
                                Form group for {field.label}
                                <select
                                  disabled={!editable}
                                  value={selectedGroup ?? ""}
                                  onChange={(event) => execute(createAssignWeeklyFieldGroupCommand({
                                    owner,
                                    fieldId: field.id,
                                    ...(event.currentTarget.value === ""
                                      ? {}
                                      : { groupId: event.currentTarget.value }),
                                  }), `Moved weekly field “${field.label}”.`)}
                                >
                                  <option value="">Other fields</option>
                                  {groups.map((group) => (
                                    <option key={group.id} value={group.id}>{group.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Church Profile value for {field.label}
                                <select
                                  disabled={!editable || profileOptions.length === 0}
                                  value={selectedProfileKey ?? ""}
                                  onChange={(event) => execute(
                                    createSetWeeklyFieldProfileMappingCommand({
                                      owner,
                                      fieldId: field.id,
                                      ...(event.currentTarget.value === ""
                                        ? {}
                                        : {
                                            profileKey: event.currentTarget.value as ChurchProfileFieldKey,
                                          }),
                                    }),
                                    event.currentTarget.value === ""
                                      ? `Stopped offering a Church Profile value for “${field.label}”.`
                                      : `Connected “${field.label}” to Church Profile.`,
                                  )}
                                >
                                  <option value="">
                                    {profileOptions.length > 0 ? "Do not offer a profile value" : "Not compatible"}
                                  </option>
                                  {profileOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <SampleValueControl
                                key={`${field.id}:${JSON.stringify(sampleValues?.[field.id]?.value)}`}
                                field={field}
                                value={sampleValues?.[field.id]?.value}
                                disabled={!editable}
                                onCommit={(value) => execute(
                                  createSetWeeklyFieldSampleValueCommand({
                                    owner,
                                    fieldId: field.id,
                                    value,
                                  }),
                                  `Saved a preview-only sample for “${field.label}”.`,
                                )}
                                onClear={() => execute(
                                  createSetWeeklyFieldSampleValueCommand({
                                    owner,
                                    fieldId: field.id,
                                    value: undefined,
                                  }),
                                  `Cleared the sample/test value for “${field.label}”.`,
                                )}
                              />
                            </div>
                          </div>
                          <div className="cbb-template-row-actions">
                            <Button
                              aria-label={`Move ${field.label} field up`}
                              disabled={!editable || prior === undefined}
                              onClick={() => {
                                if (prior === undefined) return;
                                execute(createReorderWeeklyFieldCommand({
                                  owner,
                                  fieldId: field.id,
                                  toIndex: fields.findIndex((candidate) => candidate.id === prior.id),
                                }), `Moved weekly field “${field.label}” up.`);
                              }}
                            >Up</Button>
                            <Button
                              aria-label={`Move ${field.label} field down`}
                              disabled={!editable || next === undefined}
                              onClick={() => {
                                if (next === undefined) return;
                                execute(createReorderWeeklyFieldCommand({
                                  owner,
                                  fieldId: field.id,
                                  toIndex: fields.findIndex((candidate) => candidate.id === next.id),
                                }), `Moved weekly field “${field.label}” down.`);
                              }}
                            >Down</Button>
                            <Button
                              disabled={!editable}
                              onClick={() => {
                                setAddingField(false);
                                setEditingFieldId(field.id);
                              }}
                            >Edit</Button>
                            <Button
                              variant="danger"
                              disabled={!editable}
                              onClick={() => {
                                if (!confirm(`Remove “${field.label}” and every connection or section rule that uses it?`)) return;
                                execute(
                                  createRemoveWeeklyFieldCommand({ owner, fieldId: field.id }),
                                  `Removed weekly field “${field.label}”.`,
                                );
                              }}
                            >Remove</Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {addingField || editableField !== undefined ? (
          <WeeklyFieldForm
            key={editableField?.id ?? `new-${ownerKey(owner)}`}
            initial={editableField}
            groups={groups}
            onSubmit={submitField}
            onCancel={() => {
              setAddingField(false);
              setEditingFieldId(undefined);
            }}
          />
        ) : null}

        <section className="cbb-template-subsection" aria-labelledby="weekly-connections-heading">
          <h3 id="weekly-connections-heading">Linked weekly fields</h3>
          <p>Connect visible content to the weekly setup form. The connection—not an internal path—is what volunteers see.</p>

          {connections.filter((connection) => connection.binding !== undefined).length === 0 ? (
            <p className="cbb-template-empty">No visible content is connected yet.</p>
          ) : (
            <ul className="cbb-template-list" aria-label="Linked weekly fields">
              {connections.filter((connection) => connection.binding !== undefined).map((connection) => {
                const binding = connection.binding as NonNullable<ConnectionOption["binding"]>;
                const field = fields.find((candidate) => candidate.id === binding.fieldId);
                return (
                  <li key={connection.key}>
                    <div>
                      <strong>{connection.nodeName}: {connection.property.label}</strong>
                      <span>{TASK_LANGUAGE.linkedWeeklyField}: {field?.label ?? "Missing weekly field"}</span>
                    </div>
                    <Button
                      disabled={!editable}
                      onClick={() => execute(
                        createMakeIndependentCommand({ owner, nodeId: connection.nodeId, bindingId: binding.id }),
                        `Made ${connection.nodeName} independent.`,
                      )}
                    >{TASK_LANGUAGE.makeIndependent}</Button>
                  </li>
                );
              })}
            </ul>
          )}

          <fieldset disabled={!editable || connections.every((connection) => connection.binding !== undefined)}>
            <legend>Connect content</legend>
            <label>
              Content to connect
              <select
                value={selectedConnection?.key ?? ""}
                onChange={(event) => {
                  setConnectionKey(event.currentTarget.value);
                  setConnectionFieldId("");
                  setMakingConnection(false);
                }}
              >
                {connections.filter((connection) => connection.binding === undefined).map((connection) => (
                  <option key={connection.key} value={connection.key}>
                    {connection.nodeName}: {connection.property.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="cbb-template-connect-actions">
              <label>
                Existing weekly field
                <select
                  value={connectionFieldId}
                  onChange={(event) => setConnectionFieldId(event.currentTarget.value)}
                >
                  <option value="">Choose a field</option>
                  {compatibleFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                </select>
              </label>
              <Button
                disabled={selectedConnection === undefined || connectionFieldId === ""}
                onClick={() => {
                  if (selectedConnection === undefined) return;
                  execute(createLinkWeeklyFieldCommand({
                    owner,
                    nodeId: selectedConnection.nodeId,
                    fieldId: connectionFieldId,
                    target: selectedConnection.property.target,
                    bindingId: `connection-${props.idPort.randomUuid()}`,
                    ...(selectedConnection.property.currentValue === undefined
                      ? {}
                      : { fallback: selectedConnection.property.currentValue }),
                  }), "Connected weekly field.");
                }}
              >Connect field</Button>
            </div>
            <div className="cbb-template-or" aria-hidden="true">or</div>
            <div className="cbb-template-connect-actions">
              <Button
                variant="primary"
                disabled={selectedConnection === undefined}
                onClick={() => setMakingConnection(true)}
              >Make this a weekly field</Button>
            </div>
            {makingConnection && connectionFieldDraft !== undefined ? (
              <WeeklyFieldForm
                key={`connection-${selectedConnection?.key ?? "none"}`}
                initialDraft={connectionFieldDraft}
                groups={groups}
                heading={`Make ${selectedConnection?.nodeName ?? "content"} a weekly field`}
                submitLabel="Create and connect weekly field"
                onSubmit={submitConnectionField}
                onCancel={() => setMakingConnection(false)}
              />
            ) : null}
          </fieldset>

          <section className="cbb-template-subsection" aria-labelledby="unlinked-review-heading">
            <h4 id="unlinked-review-heading">Unlinked content review</h4>
            <p>Choose when volunteers should recheck visible content that is not a weekly field.</p>
            {unboundReviewElements.length === 0 ? (
              <p className="cbb-template-empty">Every reviewable item is linked to a weekly field.</p>
            ) : (
              <ul className="cbb-template-list" aria-label="Unlinked content review reminders">
                {unboundReviewElements.map((element) => (
                  <li key={element.id}>
                    <strong>{element.name}</strong>
                    <label>
                      Review reminder for {element.name}
                      <select
                        disabled={!editable}
                        value={element.weeklyReview ?? "none"}
                        onChange={(event) => execute(createSetUnboundContentReviewCommand({
                          owner,
                          nodeId: element.id,
                          weeklyReview: event.currentTarget.value as
                            "everyBulletin" | "whenDuplicated" | "none",
                        }), `Updated the review reminder for ${element.name}.`)}
                      >
                        <option value="everyBulletin">Review every bulletin</option>
                        <option value="whenDuplicated">Review when duplicated</option>
                        <option value="none">No reminder</option>
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </div>

      <div
        id="template-panel-rules"
        role="tabpanel"
        aria-labelledby="template-tab-rules"
        hidden={tab !== "rules"}
        className="cbb-template-panel"
      >
        <div className="cbb-template-section-heading">
          <div>
            <h3>Section rules</h3>
            <p>Show a section when it is needed, or let the weekly editor add several items.</p>
          </div>
          <div className="cbb-template-segmented" role="group" aria-label="Rule type">
            <button
              type="button"
              aria-pressed={ruleEditor === "conditional"}
              onClick={() => {
                setRuleEditor("conditional");
                setEditingRuleId(undefined);
                setConditionalPreview("active");
                setConditionalPreviewSeen(new Set(["active"]));
              }}
            >Show this section when</button>
            <button
              type="button"
              aria-pressed={ruleEditor === "repeat"}
              onClick={() => {
                setRuleEditor("repeat");
                setEditingRuleId(undefined);
                setRepeatPreview("items");
                setRepeatPreviewSeen(new Set(["items"]));
              }}
            >Allow more than one</button>
          </div>
        </div>

        {rules.length === 0 ? <p className="cbb-template-empty">No section rules yet.</p> : (
          <ul className="cbb-template-list" aria-label="Section rules">
            {rules.map((rule) => (
              <li key={rule.id}>
                <div>
                  <RuleSummary
                    rule={rule}
                    field={fields.find((field) => field.id === rule.fieldId)}
                    node={elements.find((element) => element.id === (rule.kind === "repeat" ? rule.prototypeNodeId : rule.targetNodeId))}
                  />
                </div>
                <div className="cbb-template-row-actions">
                  <Button
                    disabled={!editable}
                    onClick={() => rule.kind === "repeat" ? beginEditRepeat(rule) : beginEditConditional(rule)}
                  >Edit</Button>
                  <Button
                    variant="danger"
                    disabled={!editable}
                    onClick={() => {
                      if (!confirm("Remove this section rule? The section itself will remain.")) return;
                      execute(createRemoveContentRuleCommand({ owner, ruleId: rule.id }), "Removed section rule.");
                    }}
                  >Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {ruleEditor === "conditional" ? (
          <form className="cbb-template-form" onSubmit={submitConditional}>
            <h4>{editingRule?.kind === "conditional" ? "Edit optional section" : "Show this section when…"}</h4>
            {conditionalFields.length === 0 ? (
              <Banner title="Add a Yes/No or choice field" tone="info">
                Optional sections need a weekly setup field that volunteers can understand.
              </Banner>
            ) : null}
            <label>
              Section
              <select required value={conditionalTarget} onChange={(event) => setConditionalTarget(event.currentTarget.value)}>
                <option value="">Choose a section</option>
                {elements.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}
              </select>
            </label>
            <label>
              Weekly field
              <select
                required
                value={conditionalFieldId}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setConditionalFieldId(value);
                  const field = conditionalFields.find((candidate) => candidate.id === value);
                  setConditionValue(field?.type === "choice" ? field.constraints?.choices?.[0]?.id ?? "" : "true");
                }}
              >
                <option value="">Choose a field</option>
                {conditionalFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
              </select>
            </label>
            {selectedConditionalField?.type === "choice" ? (
              <>
                <label>
                  Comparison
                  <select value={conditionMode} onChange={(event) => setConditionMode(event.currentTarget.value as "equals" | "notEquals")}>
                    <option value="equals">is</option>
                    <option value="notEquals">is not</option>
                  </select>
                </label>
                <label>
                  Choice
                  <select value={conditionValue} onChange={(event) => setConditionValue(event.currentTarget.value)}>
                    {selectedConditionalField.constraints?.choices?.map((choice) => (
                      <option key={choice.id} value={choice.id}>{choice.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label>
                Answer
                <select value={conditionValue} onChange={(event) => setConditionValue(event.currentTarget.value)}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            )}
            <label>
              Action when active
              <input value={activeLabel} onChange={(event) => setActiveLabel(event.currentTarget.value)} />
            </label>
            <label>
              Action when inactive
              <input value={inactiveLabel} onChange={(event) => setInactiveLabel(event.currentTarget.value)} />
            </label>
            <fieldset className="cbb-template-preview cbb-template-span">
              <legend>Preview optional section</legend>
              <label><input type="radio" name="conditional-preview" checked={conditionalPreview === "active"} onChange={() => {
                setConditionalPreview("active");
                setConditionalPreviewSeen((seen) => new Set([...seen, "active"]));
              }} /> Active</label>
              <label><input type="radio" name="conditional-preview" checked={conditionalPreview === "inactive"} onChange={() => {
                setConditionalPreview("inactive");
                setConditionalPreviewSeen((seen) => new Set([...seen, "inactive"]));
              }} /> Inactive</label>
              <p>{conditionalPreview === "active" ? "The section is included." : "The section is left out."}</p>
              <p role="status">{conditionalPreviewSeen.size < 2
                ? "Preview both states to enable saving."
                : "Both optional-section states reviewed."}</p>
            </fieldset>
            <div className="cbb-template-form-actions cbb-template-span">
              <Button type="submit" variant="primary" disabled={!editable || conditionalFields.length === 0 || conditionalPreviewSeen.size < 2}>
                {editingRule?.kind === "conditional" ? "Save rule changes" : "Add optional-section rule"}
              </Button>
              {editingRuleId ? <Button onClick={() => setEditingRuleId(undefined)}>Cancel edit</Button> : null}
            </div>
          </form>
        ) : (
          <form className="cbb-template-form" onSubmit={submitRepeat}>
            <h4>{editingRule?.kind === "repeat" ? "Edit repeated section" : "Allow more than one"}</h4>
            {repeatFields.length === 0 ? (
              <Banner title="Add a Repeatable list field" tone="info">
                Repeated sections need a bounded list in the weekly setup form.
              </Banner>
            ) : null}
            <label>
              Section used as each item
              <select required value={repeatPrototype} onChange={(event) => {
                setRepeatPrototype(event.currentTarget.value);
                setRepeatItemConnections({});
              }}>
                <option value="">Choose a section</option>
                {elements.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}
              </select>
            </label>
            <label>
              Repeatable weekly field
              <select required value={repeatFieldId} onChange={(event) => {
                const value = event.currentTarget.value;
                setRepeatFieldId(value);
                setRepeatItemConnections({});
                const maximum = repeatFields.find((field) => field.id === value)?.constraints?.maxItems;
                if (maximum !== undefined) setRepeatMaximum(String(Math.min(10, maximum)));
              }}>
                <option value="">Choose a list</option>
                {repeatFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
              </select>
            </label>
            {selectedRepeatItemLeaves.length === 0 ? null : (
              <fieldset className="cbb-template-span cbb-template-repeat-bindings">
                <legend>{selectedRepeatItemLeaves.length === 1
                  ? "Content filled by each item"
                  : "Connect each structured item field"}</legend>
                {selectedRepeatItemLeaves.map((leaf) => (
                  <label key={leaf.path || "item"}>
                    {selectedRepeatItemLeaves.length === 1
                      ? "Content filled by each item"
                      : `Content for ${leaf.field.label}`}
                    <select
                      value={repeatItemConnections[leaf.path] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRepeatItemConnections((current) => ({
                          ...current,
                          [leaf.path]: value,
                        }));
                      }}
                    >
                      <option value="">Do not replace content for this value</option>
                      {(repeatConnectionOptions[leaf.path] ?? []).map((connection) => (
                        <option key={connection.key} value={connection.key}>
                          {connection.nodeName}: {connection.property.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              Item name
              <input required value={repeatItemLabel} onChange={(event) => setRepeatItemLabel(event.currentTarget.value)} />
            </label>
            <label>
              Add button label
              <input required value={repeatAddLabel} onChange={(event) => setRepeatAddLabel(event.currentTarget.value)} />
            </label>
            <label>
              Maximum items
              <input type="number" min="1" max="1000" required value={repeatMaximum} onChange={(event) => setRepeatMaximum(event.currentTarget.value)} />
            </label>
            <label>
              When the list is empty
              <select value={repeatEmptyMode} onChange={(event) => setRepeatEmptyMode(event.currentTarget.value as "collapse" | "show")}>
                <option value="collapse">Hide the repeated section</option>
                <option value="show">Show an empty-message section</option>
              </select>
            </label>
            {repeatEmptyMode === "show" ? (
              <label>
                Empty-message section
                <select required value={repeatEmptyNode} onChange={(event) => setRepeatEmptyNode(event.currentTarget.value)}>
                  <option value="">Choose a section</option>
                  {elements.filter((element) => element.id !== repeatPrototype).map((element) => (
                    <option key={element.id} value={element.id}>{element.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="cbb-template-checkbox">
              <input type="checkbox" checked={repeatReorderable} onChange={(event) => setRepeatReorderable(event.currentTarget.checked)} />
              Let the weekly editor reorder items
            </label>
            <fieldset className="cbb-template-preview cbb-template-span">
              <legend>Preview repeated section</legend>
              <label><input type="radio" name="repeat-preview" checked={repeatPreview === "items"} onChange={() => {
                setRepeatPreview("items");
                setRepeatPreviewSeen((seen) => new Set([...seen, "items"]));
              }} /> With items</label>
              <label><input type="radio" name="repeat-preview" checked={repeatPreview === "empty"} onChange={() => {
                setRepeatPreview("empty");
                setRepeatPreviewSeen((seen) => new Set([...seen, "empty"]));
              }} /> Empty</label>
              <p>{repeatPreview === "items" ? `Shows up to ${repeatMaximum || "the chosen maximum"} ${repeatItemLabel.toLowerCase()} entries.` : repeatEmptyMode === "collapse" ? "The repeated section is hidden." : "The empty-message section is shown."}</p>
              <p role="status">{repeatPreviewSeen.size < 2
                ? "Preview both states to enable saving."
                : "Both repeated-section states reviewed."}</p>
            </fieldset>
            <div className="cbb-template-form-actions cbb-template-span">
              <Button type="submit" variant="primary" disabled={!editable || repeatFields.length === 0 || repeatPreviewSeen.size < 2}>
                {editingRule?.kind === "repeat" ? "Save rule changes" : "Add repeated-section rule"}
              </Button>
              {editingRuleId ? <Button onClick={() => setEditingRuleId(undefined)}>Cancel edit</Button> : null}
            </div>
          </form>
        )}
      </div>

      <div
        id="template-panel-savedSections"
        role="tabpanel"
        aria-labelledby="template-tab-savedSections"
        hidden={tab !== "savedSections"}
        className="cbb-template-panel"
      >
        <div className="cbb-template-section-heading">
          <div>
            <h3>{TASK_LANGUAGE.savedSections}</h3>
            <p>Reuse a section without rebuilding it. Inserted copies stay linked until you make one independent.</p>
          </div>
        </div>

        {props.document.customElementDefinitions?.length ? (
          <ul className="cbb-template-list" aria-label="Saved Sections">
            {props.document.customElementDefinitions.map((definition) => {
              const count = authorableElements(props.document, { kind: "document" }).filter(
                (element) => element.type === "customInstance" && element.definitionId === definition.id,
              ).length;
              return (
                <li key={definition.id} className="cbb-template-saved-card">
                  <div>
                    {renamingDefinitionId === definition.id ? (
                      <label>
                        New Saved section name
                        <input
                          autoFocus
                          required
                          value={renamedSavedSection}
                          onChange={(event) => setRenamedSavedSection(event.currentTarget.value)}
                        />
                      </label>
                    ) : <strong>{definition.name}</strong>}
                    <span>{count} inserted {count === 1 ? "copy" : "copies"}</span>
                    {definition.description ? <small>{definition.description}</small> : null}
                  </div>
                  <div className="cbb-template-row-actions">
                    <Button
                      disabled={!editable}
                      onClick={() => execute(createInsertSavedSectionCommand({
                        definitionId: definition.id,
                        instanceId: mintNodeId(props.document, props.idPort),
                        index: props.document.elements.length,
                      }), `Inserted Saved section “${definition.name}”.`)}
                    >Insert</Button>
                    <Button
                      disabled={!editable}
                      onClick={() => execute(createDuplicateSavedSectionCommand({
                        definitionId: definition.id,
                        duplicateDefinitionId: mintNodeId(props.document, props.idPort),
                        contractId: props.idPort.randomUuid(),
                        name: `${definition.name} copy`,
                        idPort: props.idPort,
                      }), `Duplicated Saved section “${definition.name}”.`)}
                    >Duplicate</Button>
                    {renamingDefinitionId === definition.id ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={renamedSavedSection.trim() === ""}
                          onClick={() => {
                            if (execute(createRenameSavedSectionCommand({
                              definitionId: definition.id,
                              name: renamedSavedSection,
                            }), "Renamed Saved section.")) {
                              setRenamingDefinitionId(undefined);
                            }
                          }}
                        >Save name</Button>
                        <Button onClick={() => setRenamingDefinitionId(undefined)}>Cancel</Button>
                      </>
                    ) : (
                      <Button
                        disabled={!editable}
                        onClick={() => {
                          setRenamingDefinitionId(definition.id);
                          setRenamedSavedSection(definition.name);
                        }}
                      >Rename</Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={!editable || count > 0}
                      title={count > 0 ? "Make every inserted copy independent first." : undefined}
                      onClick={() => {
                        if (!confirm(`Remove Saved section “${definition.name}” from this bulletin?`)) return;
                        execute(createRemoveSavedSectionCommand({ definitionId: definition.id }), "Removed Saved section.");
                      }}
                    >Remove</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="cbb-template-empty">No Saved Sections in this bulletin yet.</p>}

        {props.selectedNodeId !== undefined && findElementLocation(props.document, props.selectedNodeId)?.element.type === "customInstance" ? (
          <div className="cbb-template-callout">
            <h4>Selected inserted copy</h4>
            <p>Use {TASK_LANGUAGE.makeIndependent} to change only this copy. Future Saved Section updates will no longer affect it.</p>
            <Button
              disabled={!editable}
              onClick={() => execute(createMakeSavedSectionIndependentCommand({
                instanceId: props.selectedNodeId as NodeId,
                idPort: props.idPort,
              }), "Made this Saved section independent.")}
            >{TASK_LANGUAGE.makeIndependent}</Button>
          </div>
        ) : (
          <form
            className="cbb-template-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (props.selectedNodeId === undefined) return;
              if (execute(createSaveAsSavedSectionCommand({
                nodeId: props.selectedNodeId,
                definitionId: mintNodeId(props.document, props.idPort),
                contractId: props.idPort.randomUuid(),
                name: savedName,
                ...(savedDescription.trim() ? { description: savedDescription } : {}),
                idPort: props.idPort,
              }), `Saved “${savedName}” for reuse.`)) {
                setSavedName("");
                setSavedDescription("");
              }
            }}
          >
            <h4>Save selected section for reuse</h4>
            {props.selectedNodeId === undefined ? (
              <p className="cbb-template-empty cbb-template-span">Select a section in the page or Structure panel first.</p>
            ) : null}
            <label>
              Saved section name
              <input required value={savedName} onChange={(event) => setSavedName(event.currentTarget.value)} />
            </label>
            <label>
              Description (optional)
              <input value={savedDescription} onChange={(event) => setSavedDescription(event.currentTarget.value)} />
            </label>
            <div className="cbb-template-form-actions cbb-template-span">
              <Button type="submit" variant="primary" disabled={!editable || props.selectedNodeId === undefined}>
                Save section for reuse
              </Button>
            </div>
          </form>
        )}
      </div>

      <div
        id="template-panel-template"
        role="tabpanel"
        aria-labelledby="template-tab-template"
        hidden={tab !== "template"}
        className="cbb-template-panel"
      >
        <h3>Template actions</h3>
        <p>These actions create explicit library items. Normal editing already saves the template or bulletin currently open.</p>
        <div className="cbb-template-action-grid">
          {props.document.kind === "bulletin" && props.onSaveAsTemplate !== undefined ? (
            <article>
              <h4>Save for future weeks</h4>
              <p>Review weekly values before creating a reusable template.</p>
              <Button variant="primary" onClick={() => props.onSaveAsTemplate?.(props.document)}>
                Save this bulletin as a template
              </Button>
            </article>
          ) : null}
          <article>
            <h4>Try the volunteer experience</h4>
            <p>Preview setup fields and section behavior in a disposable test.</p>
            <Button disabled={props.onTestWeeklyWorkflow === undefined} onClick={() => props.onTestWeeklyWorkflow?.(props.document)}>
              Test weekly workflow
            </Button>
          </article>
          {props.document.kind === "template" && props.onDuplicateTemplate !== undefined ? (
            <article>
              <h4>Work with this template</h4>
              <p>Create another library template without changing this one.</p>
              <Button onClick={() => props.onDuplicateTemplate?.(props.document)}>
                Duplicate template
              </Button>
            </article>
          ) : null}
          {props.onOpenSourceTemplate !== undefined ? <article>
            <h4>Source template</h4>
            <p>This bulletin has a workspace source link. Open it before making a reviewed change for future bulletins.</p>
            <div className="cbb-template-form-actions">
              {props.onChangeOnlyThisBulletin === undefined ? null : <Button onClick={() => props.onChangeOnlyThisBulletin?.()}>
                Change only this bulletin
              </Button>}
              {props.onUpdateTemplateForFutureBulletins === undefined ? null : <Button onClick={() => props.onUpdateTemplateForFutureBulletins?.(props.document)}>
                Review changes for the source template
              </Button>}
              <Button onClick={() => props.onOpenSourceTemplate?.()}>
                Open source template
              </Button>
            </div>
          </article> : null}
        </div>
      </div>
    </section>
  );
}
