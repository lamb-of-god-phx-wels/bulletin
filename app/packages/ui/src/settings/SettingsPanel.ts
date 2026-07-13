import { createElement as h, useId } from "react";
import { isPositive, parseLength } from "@cbb/core";
import { Button, PageHeader } from "../design-system/index.js";

export type AppTheme = "system" | "light" | "dark";
export type EditorViewMode = "page" | "contiguous";
export type PagePresentation = "single" | "facing";
export type PreviewZoom = "fitPage" | "fitWidth" | number;

export interface UiSettings {
  readonly language: string;
  readonly theme: AppTheme;
  readonly viewMode: EditorViewMode;
  readonly pagePresentation: PagePresentation;
  readonly previewZoom: PreviewZoom;
  readonly marginGuides: boolean;
  readonly livePreview: boolean;
  readonly technicalPdfDetails: boolean;
  readonly canvasSnap: boolean;
  readonly canvasSnapGridSize: string;
  readonly exportFilenamePattern: string;
  readonly offlineSpellcheck: boolean;
  readonly displayTimeZone: string;
}

export const DEFAULT_UI_SETTINGS: UiSettings = Object.freeze({
  language: "en-US",
  theme: "system",
  viewMode: "page",
  pagePresentation: "facing",
  previewZoom: "fitPage",
  marginGuides: true,
  livePreview: true,
  technicalPdfDetails: false,
  canvasSnap: true,
  canvasSnapGridSize: "0.125in",
  exportFilenamePattern: "{date:YYYY-MM-DD} {name}.pdf",
  offlineSpellcheck: true,
  displayTimeZone: "UTC",
});

export interface SettingsPanelProps {
  readonly value: UiSettings;
  readonly onChange: (value: UiSettings) => void;
  readonly onSave?: () => void;
  readonly statusMessage?: string;
}

export interface UiSettingsValidationErrors {
  readonly canvasSnapGridSize?: string;
  readonly exportFilenamePattern?: string;
  readonly displayTimeZone?: string;
}

const SNAP_GRID_SIZE =
  /^(?:(?:0*[1-9][0-9]*)(?:\.[0-9]+)?|0+\.0*[1-9][0-9]*)(?:pt|in|cm|mm)$/u;
const FORBIDDEN_FILENAME_PATTERN_CHARACTERS = /[\u0000-\u001f\u007f/\\]/u;
const TIME_ZONE_SHAPE =
  /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z][A-Za-z0-9._+-]*)*$/u;

function snapGridSizeError(value: string): string | undefined {
  if (!SNAP_GRID_SIZE.test(value)) {
    return "Enter a positive physical length such as 0.125in, using pt, in, cm, or mm.";
  }
  try {
    const parsed = parseLength(value);
    if (parsed.kind !== "absolute" || !isPositive(parsed.pt)) {
      return "Snap grid size must be greater than zero.";
    }
  } catch {
    return "Enter a positive physical length such as 0.125in, using pt, in, cm, or mm.";
  }
  return undefined;
}

function exportFilenamePatternError(value: string): string | undefined {
  if (value.length === 0) return "Enter a PDF filename pattern.";
  if (value.length > 240) return "Keep the PDF filename pattern to 240 characters or fewer.";
  if (FORBIDDEN_FILENAME_PATTERN_CHARACTERS.test(value)) {
    return "A PDF filename pattern cannot contain path separators or control characters.";
  }
  return undefined;
}

function displayTimeZoneError(value: string): string | undefined {
  if (value.length === 0) return "Enter an IANA time zone such as America/Phoenix.";
  if (value.length > 128 || !TIME_ZONE_SHAPE.test(value)) {
    return "Enter an IANA time zone such as America/Phoenix.";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return undefined;
  } catch {
    return "That time zone is not available on this computer.";
  }
}

/** Match the settings schema and renderer-to-host contract before crossing IPC. */
export function validateUiSettings(value: UiSettings): UiSettingsValidationErrors {
  const canvasSnapGridSize = snapGridSizeError(value.canvasSnapGridSize);
  const exportFilenamePattern = exportFilenamePatternError(value.exportFilenamePattern);
  const displayTimeZone = displayTimeZoneError(value.displayTimeZone);
  return {
    ...(canvasSnapGridSize === undefined ? {} : { canvasSnapGridSize }),
    ...(exportFilenamePattern === undefined ? {} : { exportFilenamePattern }),
    ...(displayTimeZone === undefined ? {} : { displayTimeZone }),
  };
}

function Choice<T extends string>({ id, label, value, options, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  return h("div", { className: "cbb-field" },
    h("label", { htmlFor: id }, label),
    h("select", {
      id,
      value,
      onChange: (event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value as T),
    }, ...options.map((option) => h("option", { key: option.value, value: option.value }, option.label))),
  );
}

function Toggle({ id, label, checked, onChange, hint }: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string;
}) {
  return h("div", null,
    h("label", { className: "cbb-choice-row", htmlFor: id },
      h("input", {
        id,
        type: "checkbox",
        checked,
        onChange: (event: { currentTarget: { checked: boolean } }) => onChange(event.currentTarget.checked),
      }),
      h("span", null, label, hint === undefined ? null : h("span", { className: "cbb-field__hint" }, h("br"), hint)),
    ),
  );
}

export function SettingsPanel({ value, onChange, onSave, statusMessage }: SettingsPanelProps) {
  const id = useId();
  const update = <Key extends keyof UiSettings>(key: Key, next: UiSettings[Key]) => onChange({ ...value, [key]: next });
  const zoomValue = typeof value.previewZoom === "number" ? String(value.previewZoom) : value.previewZoom;
  const errors = validateUiSettings(value);
  const settingsAreValid = Object.keys(errors).length === 0;
  const gridHintId = `${id}-grid-hint`;
  const gridErrorId = `${id}-grid-error`;
  const filenameHintId = `${id}-filename-hint`;
  const filenameErrorId = `${id}-filename-error`;
  const timeZoneHintId = `${id}-timezone-hint`;
  const timeZoneErrorId = `${id}-timezone-error`;

  return h("div", null,
    h(PageHeader, {
      title: "Settings",
      description: "These preferences change how the app works, not how an existing bulletin prints.",
    }),
    h("div", { className: "cbb-settings-grid" },
      h("fieldset", { className: "cbb-settings-group" },
        h("legend", null, "Appearance and language"),
        h(Choice, {
          id: `${id}-language`, label: "App language", value: value.language,
          options: [{ value: "en-US", label: "English (United States)" }],
          onChange: (next) => update("language", next),
        }),
        h(Choice, {
          id: `${id}-theme`, label: "App theme", value: value.theme,
          options: [
            { value: "system", label: "Use system setting" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
          onChange: (next: string) => update("theme", next as AppTheme),
        }),
      ),
      h("fieldset", { className: "cbb-settings-group" },
        h("legend", null, "Editor view"),
        h(Choice, {
          id: `${id}-view`, label: "Default editor view", value: value.viewMode,
          options: [{ value: "page", label: "Page View" }, { value: "contiguous", label: "Contiguous View" }],
          onChange: (next: string) => update("viewMode", next as EditorViewMode),
        }),
        h(Choice, {
          id: `${id}-presentation`, label: "Page presentation", value: value.pagePresentation,
          options: [{ value: "single", label: "Single page" }, { value: "facing", label: "Facing pages" }],
          onChange: (next: string) => update("pagePresentation", next as PagePresentation),
        }),
        h(Choice, {
          id: `${id}-zoom`, label: "Default PDF zoom", value: zoomValue,
          options: [
            { value: "fitPage", label: "Fit page" },
            { value: "fitWidth", label: "Fit width" },
            { value: "75", label: "75%" },
            { value: "100", label: "100%" },
            { value: "125", label: "125%" },
            { value: "150", label: "150%" },
          ],
          onChange: (next) => update("previewZoom", next === "fitPage" || next === "fitWidth" ? next : Number(next)),
        }),
        h(Toggle, { id: `${id}-guides`, label: "Show margin guides", checked: value.marginGuides, onChange: (next) => update("marginGuides", next) }),
        h(Toggle, { id: `${id}-preview`, label: "Update PDF preview while editing", checked: value.livePreview, onChange: (next) => update("livePreview", next) }),
      ),
      h("fieldset", { className: "cbb-settings-group" },
        h("legend", null, "Editing assistance"),
        h(Toggle, { id: `${id}-spellcheck`, label: "Offline spellcheck", checked: value.offlineSpellcheck, onChange: (next) => update("offlineSpellcheck", next), hint: "Spelling stays on this computer." }),
        h(Toggle, { id: `${id}-snap`, label: "Snap placed items to a grid", checked: value.canvasSnap, onChange: (next) => update("canvasSnap", next) }),
        h("div", { className: "cbb-field" },
          h("label", { htmlFor: `${id}-grid` }, "Snap grid size"),
          h("input", {
            id: `${id}-grid`,
            value: value.canvasSnapGridSize,
            disabled: !value.canvasSnap,
            "aria-invalid": errors.canvasSnapGridSize === undefined ? undefined : true,
            "aria-describedby": [gridHintId, errors.canvasSnapGridSize === undefined ? undefined : gridErrorId]
              .filter(Boolean).join(" "),
            onChange: (event: { currentTarget: { value: string } }) => update("canvasSnapGridSize", event.currentTarget.value),
          }),
          h("span", { id: gridHintId, className: "cbb-field__hint" }, "Use a positive length such as 0.125in."),
          errors.canvasSnapGridSize === undefined
            ? null
            : h("span", { id: gridErrorId, className: "cbb-field__error", role: "alert" }, errors.canvasSnapGridSize),
        ),
      ),
      h("fieldset", { className: "cbb-settings-group" },
        h("legend", null, "PDF and local preferences"),
        h("div", { className: "cbb-field" },
          h("label", { htmlFor: `${id}-filename` }, "PDF filename pattern"),
          h("input", {
            id: `${id}-filename`,
            value: value.exportFilenamePattern,
            "aria-invalid": errors.exportFilenamePattern === undefined ? undefined : true,
            "aria-describedby": [filenameHintId, errors.exportFilenamePattern === undefined ? undefined : filenameErrorId]
              .filter(Boolean).join(" "),
            onChange: (event: { currentTarget: { value: string } }) => update("exportFilenamePattern", event.currentTarget.value),
          }),
          h("span", { id: filenameHintId, className: "cbb-field__hint" }, "Default: {date:YYYY-MM-DD} {name}.pdf"),
          errors.exportFilenamePattern === undefined
            ? null
            : h("span", { id: filenameErrorId, className: "cbb-field__error", role: "alert" }, errors.exportFilenamePattern),
        ),
        h("div", { className: "cbb-field" },
          h("label", { htmlFor: `${id}-timezone` }, "Display time zone"),
          h("input", {
            id: `${id}-timezone`,
            value: value.displayTimeZone,
            "aria-invalid": errors.displayTimeZone === undefined ? undefined : true,
            "aria-describedby": [timeZoneHintId, errors.displayTimeZone === undefined ? undefined : timeZoneErrorId]
              .filter(Boolean).join(" "),
            onChange: (event: { currentTarget: { value: string } }) => update("displayTimeZone", event.currentTarget.value),
          }),
          h("span", { id: timeZoneHintId, className: "cbb-field__hint" }, "Used for schedules and local times. Date-only bulletin fields do not change."),
          errors.displayTimeZone === undefined
            ? null
            : h("span", { id: timeZoneErrorId, className: "cbb-field__error", role: "alert" }, errors.displayTimeZone),
        ),
        h("details", null,
          h("summary", null, "Advanced"),
          h(Toggle, { id: `${id}-technical`, label: "Show technical PDF details", checked: value.technicalPdfDetails, onChange: (next) => update("technicalPdfDetails", next) }),
        ),
      ),
    ),
    h("div", { className: "cbb-cluster", style: { marginTop: "var(--cbb-space-5)" } },
      onSave === undefined ? null : h(Button, {
        variant: "primary",
        disabled: !settingsAreValid,
        onClick: () => {
          if (settingsAreValid) onSave();
        },
      }, "Save settings"),
      statusMessage === undefined ? null : h("span", { role: "status", "aria-live": "polite" }, statusMessage),
    ),
  );
}
