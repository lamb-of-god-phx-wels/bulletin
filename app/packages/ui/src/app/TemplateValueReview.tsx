import { useId, useMemo, useState, type ChangeEvent } from "react";
import {
  plainText,
  type CbbDocument,
  type ChurchProfileFieldKey,
  type FieldDefinition,
  type RichTextDocument,
} from "@cbb/core";
import { Banner, Button } from "../design-system/index.js";
import {
  templateValueReviewItems,
  type TemplateValueDecision,
  type TemplateValueDecisions,
  type TemplateValueDisposition,
  type TemplateValueReviewItem,
} from "./documentFactory.js";
import { trapModalTab, useModalFocus } from "./modalFocus.js";

export interface TemplateValueReviewProps {
  readonly document: CbbDocument;
  readonly title?: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly onCancel: () => void;
  readonly onConfirm: (decisions: TemplateValueDecisions) => void;
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

function initialDecision(item: TemplateValueReviewItem): TemplateValueDecision {
  return {
    disposition: item.likelyOneWeekContent || item.hasConflictingValues
      ? "clear"
      : "sample",
  };
}

function clippedText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return "Empty";
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function previewValue(value: unknown, field: FieldDefinition | undefined): string {
  if (value === null || value === undefined) return "No value";
  switch (field?.type) {
    case "text":
    case "date":
      return typeof value === "string" ? clippedText(value) : "Value available";
    case "richText":
      if (typeof value !== "object" || (value as { readonly type?: unknown }).type !== "document") {
        return "Formatted text available";
      }
      try {
        return clippedText(plainText(value as RichTextDocument));
      } catch {
        return "Formatted text available";
      }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "Number available";
    case "boolean":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : "Choice available";
    case "choice":
      return typeof value === "string"
        ? field.constraints?.choices?.find((choice) => choice.id === value)?.label ?? "Selected choice"
        : "Selected choice";
    case "assetRef":
      return "Selected image";
    case "array":
      return Array.isArray(value)
        ? `${value.length} ${value.length === 1 ? "item" : "items"}`
        : "List available";
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return "Details available";
      const count = Object.values(value).filter((entry) =>
        entry !== null && entry !== undefined && entry !== ""
      ).length;
      return count === 0 ? "No details filled" : `${count} ${count === 1 ? "detail" : "details"} filled`;
    }
    default:
      if (typeof value === "string") return clippedText(value);
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return "Value available";
  }
}

export function TemplateValueReview({
  document,
  title = "Review weekly values",
  description = "Decide what belongs in the reusable template. Bulletin values never become defaults without your choice.",
  confirmLabel = "Create template",
  onCancel,
  onConfirm,
}: TemplateValueReviewProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useModalFocus<HTMLElement>();
  const items = useMemo(() => templateValueReviewItems(document), [document]);
  const [decisions, setDecisions] = useState<TemplateValueDecisions>(() => Object.fromEntries(
    items.map((item) => [item.decisionKey, initialDecision(item)]),
  ));

  function update(decisionKey: string, decision: TemplateValueDecision): void {
    setDecisions((current) => ({ ...current, [decisionKey]: decision }));
  }

  function dispositionChanged(
    item: (typeof items)[number],
    event: ChangeEvent<HTMLSelectElement>,
  ): void {
    const disposition = event.currentTarget.value as TemplateValueDisposition;
    const firstProfileKey = item.profileKeys[0];
    update(item.decisionKey, disposition === "profile" && firstProfileKey !== undefined
      ? { disposition, profileKey: firstProfileKey }
      : { disposition });
  }

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
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          trapModalTab(event, dialogRef.current);
        }}
      >
        <div className="cbb-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <Button autoFocus onClick={onCancel}>Cancel</Button>
        </div>
        {items.length === 0 ? (
          <Banner tone="info" title="No weekly values to review">
            This bulletin can be saved as a template as-is.
          </Banner>
        ) : (
          <div className="cbb-template-value-list">
            {items.map((item) => {
              const decision = decisions[item.decisionKey] ?? initialDecision(item);
              const fieldId = `${titleId}-${encodeURIComponent(item.decisionKey)}`;
              const displayLabel = item.ownerLabel === undefined
                ? item.label
                : `${item.ownerLabel} — ${item.label}`;
              return (
                <fieldset key={item.decisionKey} className="cbb-template-value-row">
                  <legend>{displayLabel}</legend>
                  <p className="cbb-template-value-row__value">
                    {item.hasConflictingValues
                      ? `${item.valueCount} inserted copies have different current values.`
                      : `Current value: ${previewValue(item.value.value, item.field)}`}
                  </p>
                  {item.target.scope === "savedSection" ? (
                    <p>
                      This choice applies to {item.occurrenceCount} {item.occurrenceCount === 1
                        ? "inserted copy"
                        : "inserted copies"} of this Saved Section.
                    </p>
                  ) : null}
                  {item.hasConflictingValues ? (
                    <Banner tone="warning" title="These copies need one shared choice">
                      A Saved Section field has one shared default and sample. Clear these weekly values or use one compatible Church Profile value.
                    </Banner>
                  ) : null}
                  <label htmlFor={`${fieldId}-action`}>Use {displayLabel} in the template as</label>
                  <select
                    id={`${fieldId}-action`}
                    value={decision.disposition}
                    onChange={(event) => dispositionChanged(item, event)}
                  >
                    <option value="clear">Clear it for each new bulletin</option>
                    <option value="default" disabled={item.hasConflictingValues}>Template default</option>
                    <option value="sample" disabled={item.hasConflictingValues}>Sample/test value only</option>
                    {item.profileCompatible ? <option value="profile">Church Profile value</option> : null}
                  </select>
                  {decision.disposition === "profile" ? (
                    <label htmlFor={`${fieldId}-profile`}>
                      Profile value
                      <select
                        id={`${fieldId}-profile`}
                        value={decision.profileKey ?? item.profileKeys[0] ?? ""}
                        onChange={(event) => update(item.decisionKey, {
                          disposition: "profile",
                          profileKey: event.currentTarget.value as ChurchProfileFieldKey,
                        })}
                      >
                        {item.profileKeys.map((profileKey) => (
                          <option key={profileKey} value={profileKey}>
                            {CHURCH_PROFILE_LABELS[profileKey]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {item.likelyOneWeekContent && decision.disposition === "default" ? (
                    <p className="cbb-field-error" role="alert">
                      This looks specific to one week. Keep it as a default only if every new bulletin should start with it.
                    </p>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        )}
        <div className="cbb-modal__actions">
          <Button onClick={onCancel}>Keep editing</Button>
          <Button variant="primary" onClick={() => onConfirm(decisions)}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}
