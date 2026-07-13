import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  lengthToEditorPixels,
  formatIsoDate,
  parseLength,
  plainText,
  scriptureTypographyPresetId,
  scriptureTypographyPresetSnapshot,
  type CbbDocument,
  type NativeElement,
  type NodeId,
  type TextContent,
} from "@cbb/core";
import { Button } from "../design-system/index.js";
import { TASK_LANGUAGE } from "../language/index.js";
import { checkEditorCapability, effectiveAuthoringPolicy } from "../store/capabilities.js";
import {
  createMoveCanvasChildCommand,
  createMovePageElementCommand,
  createResizeElementCommand,
  createSetAuthoringPolicyCommand,
  createSetDateValueCommand,
  createSetDatePresentationCommand,
  createSetDocumentPublicationSettingsCommand,
  createSetElementBreakPolicyCommand,
  createSetElementNameCommand,
  createSetElementSpacingCommand,
  createSetElementStyleCommand,
  createSetFinishedPageSizeCommand,
  createSetImageAccessibilityCommand,
  createSetImageFitCommand,
  createSetImageFocalPointCommand,
  createSetGridLayoutCommand,
  createSetStackLayoutCommand,
  createSetPageAppearanceCommand,
  createSetPageLayoutCommand,
  createSetPageMarginCommand,
  createSetRightsAttributionOptionsCommand,
  createSetTextContentCommand,
  findElementLocation,
  findPlacementWrapperLocation,
  type ElementParent,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorCommand, EditorMode } from "../store/types.js";
import { createEditorRenderModel } from "../editor/renderModel.js";
import { CoverFocalImage } from "../editor/CoverFocalImage.js";
import { inspectorCanonicalValueHash } from "./editBufferEvidence.js";

export type InspectorTab = "content" | "layout" | "appearance" | "accessibility";

export interface InspectorEditBufferUpdate {
  readonly controlId: string;
  readonly value: string;
  readonly baseDocumentRevision: number;
  readonly baseResourceRevisionToken: string | null;
  readonly baseCanonicalHash: string;
  readonly status: "dirty" | "invalid" | "committed" | "discarded";
  readonly error?: string;
}

export type InspectorRecoveryConflict =
  | "canonicalValueChanged"
  | "durableRevisionChanged"
  | "evidenceMissing";

export interface InspectorRestoredEditBuffer {
  readonly value: string;
  readonly baseDocumentRevision?: number | undefined;
  readonly baseResourceRevisionToken?: string | null | undefined;
  readonly baseCanonicalHash?: string | undefined;
  readonly status?: "dirty" | "invalid" | undefined;
  readonly error?: string | undefined;
  readonly recoveryConflict?: InspectorRecoveryConflict | undefined;
}

export interface InspectorPanelProps {
  readonly document: CbbDocument;
  readonly documentRevision: number;
  readonly documentRevisionToken?: string | null | undefined;
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly selectedNodeId?: NodeId | undefined;
  readonly restoredEditBuffers?: Readonly<Record<string, string | InspectorRestoredEditBuffer>> | undefined;
  readonly onEditBufferChange?: ((update: InspectorEditBufferUpdate) => void) | undefined;
  readonly onAnnouncement?: ((message: string) => void) | undefined;
  readonly onRequestImageReplacement?: ((nodeId: NodeId, currentAssetRef: string) => void) | undefined;
  readonly imageLibraryUnavailableReason?: string | undefined;
  readonly assetUrl?: ((assetRef: string) => string | undefined) | undefined;
  readonly assetInfo?: ((assetRef: string) => InspectorAssetInfo | undefined) | undefined;
}

export interface InspectorAssetInfo {
  readonly displayName: string;
  readonly kind: "raster" | "vector";
  readonly pixelWidth?: number | undefined;
  readonly pixelHeight?: number | undefined;
}

interface BufferedControlProps {
  readonly controlId: string;
  readonly label: string;
  readonly canonicalValue: string;
  readonly baseDocumentRevision: number;
  readonly baseResourceRevisionToken: string | null;
  readonly restoredValue?: string | undefined;
  readonly restoredBaseDocumentRevision?: number | undefined;
  readonly restoredBaseResourceRevisionToken?: string | null | undefined;
  readonly restoredBaseCanonicalHash?: string | undefined;
  readonly restoredError?: string | undefined;
  readonly restoredStatus?: "dirty" | "invalid" | undefined;
  readonly restoredRecoveryConflict?: InspectorRecoveryConflict | undefined;
  readonly onBuffer?: ((update: InspectorEditBufferUpdate) => void) | undefined;
  readonly onCommit: (value: string) => string | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly multiline?: boolean | undefined;
  readonly type?: "text" | "date" | "number" | "color" | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly description?: string | undefined;
}

function BufferedControl({
  controlId,
  label,
  canonicalValue,
  baseDocumentRevision,
  baseResourceRevisionToken,
  restoredValue,
  restoredBaseDocumentRevision,
  restoredBaseResourceRevisionToken,
  restoredBaseCanonicalHash,
  restoredError,
  restoredStatus,
  restoredRecoveryConflict,
  onBuffer,
  onCommit,
  disabled = false,
  disabledReason,
  multiline = false,
  type = "text",
  min,
  max,
  step,
  description,
}: BufferedControlProps) {
  const descriptionId = useId();
  const errorId = useId();
  const recoveryId = useId();
  const initialCanonicalHash = inspectorCanonicalValueHash(canonicalValue);
  const initialConflict: InspectorRecoveryConflict | undefined = restoredValue === undefined
    ? undefined
    : restoredRecoveryConflict ?? (restoredBaseCanonicalHash === undefined
      ? "evidenceMissing"
      : restoredBaseCanonicalHash === initialCanonicalHash
        ? undefined
        : "canonicalValueChanged");
  const initial = initialConflict === undefined ? restoredValue ?? canonicalValue : canonicalValue;
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>(restoredError);
  const [recoveryConflict, setRecoveryConflict] = useState<InspectorRecoveryConflict | undefined>(initialConflict);
  const dirty = useRef(initialConflict === undefined && (restoredStatus !== undefined || initial !== canonicalValue));
  const canonical = useRef(canonicalValue);
  const bufferBaseRevision = useRef(restoredBaseDocumentRevision ?? baseDocumentRevision);
  const bufferBaseResourceRevisionToken = useRef(
    restoredBaseResourceRevisionToken === undefined
      ? baseResourceRevisionToken
      : restoredBaseResourceRevisionToken,
  );
  const bufferBaseCanonicalHash = useRef(restoredBaseCanonicalHash ?? initialCanonicalHash);
  const activeControlId = useRef(controlId);

  useEffect(() => {
    if (activeControlId.current === controlId) return;
    const nextCanonicalHash = inspectorCanonicalValueHash(canonicalValue);
    const nextConflict: InspectorRecoveryConflict | undefined = restoredValue === undefined
      ? undefined
      : restoredRecoveryConflict ?? (restoredBaseCanonicalHash === undefined
        ? "evidenceMissing"
        : restoredBaseCanonicalHash === nextCanonicalHash
          ? undefined
          : "canonicalValueChanged");
    const nextValue = nextConflict === undefined ? restoredValue ?? canonicalValue : canonicalValue;
    activeControlId.current = controlId;
    canonical.current = canonicalValue;
    bufferBaseRevision.current = restoredBaseDocumentRevision ?? baseDocumentRevision;
    bufferBaseResourceRevisionToken.current = restoredBaseResourceRevisionToken === undefined
      ? baseResourceRevisionToken
      : restoredBaseResourceRevisionToken;
    bufferBaseCanonicalHash.current = restoredBaseCanonicalHash ?? nextCanonicalHash;
    dirty.current = nextConflict === undefined && (restoredStatus !== undefined || nextValue !== canonicalValue);
    setValue(nextValue);
    setError(restoredError);
    setRecoveryConflict(nextConflict);
  }, [baseDocumentRevision, baseResourceRevisionToken, canonicalValue, controlId, restoredBaseCanonicalHash, restoredBaseDocumentRevision, restoredBaseResourceRevisionToken, restoredError, restoredRecoveryConflict, restoredStatus, restoredValue]);

  useEffect(() => {
    if (canonical.current === canonicalValue) return;
    canonical.current = canonicalValue;
    if (!dirty.current) {
      setValue(canonicalValue);
      bufferBaseRevision.current = baseDocumentRevision;
      bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
      bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(canonicalValue);
    } else if (bufferBaseCanonicalHash.current !== inspectorCanonicalValueHash(canonicalValue)) {
      setRecoveryConflict("canonicalValueChanged");
      setValue(canonicalValue);
    }
  }, [baseDocumentRevision, baseResourceRevisionToken, canonicalValue]);

  function publish(status: InspectorEditBufferUpdate["status"], nextValue: string, nextError?: string): void {
    onBuffer?.({
      controlId,
      value: nextValue,
      baseDocumentRevision: bufferBaseRevision.current,
      baseResourceRevisionToken: bufferBaseResourceRevisionToken.current,
      baseCanonicalHash: bufferBaseCanonicalHash.current,
      status,
      ...(nextError === undefined ? {} : { error: nextError }),
    });
  }

  function change(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    const next = event.currentTarget.value;
    if (!dirty.current) {
      bufferBaseRevision.current = baseDocumentRevision;
      bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
      bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(canonical.current);
    }
    setValue(next);
    setError(undefined);
    dirty.current = next !== canonical.current;
    if (dirty.current) {
      publish("dirty", next);
    } else {
      publish("discarded", next);
      bufferBaseRevision.current = baseDocumentRevision;
      bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
      bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(canonical.current);
    }
  }

  function commit(): void {
    if (!dirty.current || recoveryConflict !== undefined) return;
    const nextError = onCommit(value);
    if (nextError !== undefined) {
      setError(nextError);
      publish("invalid", value, nextError);
      return;
    }
    setError(undefined);
    dirty.current = false;
    canonical.current = value;
    publish("committed", value);
    bufferBaseRevision.current = baseDocumentRevision;
    bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
    bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(value);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      setValue(canonical.current);
      setError(undefined);
      dirty.current = false;
      publish("discarded", canonical.current);
      bufferBaseRevision.current = baseDocumentRevision;
      bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
      bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(canonical.current);
      return;
    }
    if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  }

  const describedBy = [
    description === undefined && disabledReason === undefined ? undefined : descriptionId,
    recoveryConflict === undefined ? undefined : recoveryId,
    error === undefined ? undefined : errorId,
  ].filter((id): id is string => id !== undefined).join(" ") || undefined;
  const common = {
    id: controlId,
    value,
    disabled: disabled || recoveryConflict !== undefined,
    "aria-invalid": error === undefined ? undefined : true,
    "aria-describedby": describedBy,
    onChange: change,
    onBlur: commit,
    onKeyDown: keyDown,
  };

  return (
    <div className={`cbb-inspector-field${error === undefined ? "" : " has-error"}`}>
      <label htmlFor={controlId}>{label}</label>
      {recoveryConflict === undefined || restoredValue === undefined
        ? null
        : (
            <div id={recoveryId} className="cbb-recovery-conflict" role="alert">
              <strong>Recovered text needs your decision</strong>
              <p>{recoveryConflict === "durableRevisionChanged"
                ? "The saved bulletin changed after this unfinished value was captured. It will not replace the current value unless you choose it."
                : recoveryConflict === "canonicalValueChanged"
                  ? "This control’s saved value changed after the unfinished text was captured. Compare them before applying anything."
                  : "This older recovery record does not contain enough evidence to apply automatically."}</p>
              <details>
                <summary>Preview recovered text</summary>
                <pre>{restoredValue.slice(0, 1000)}{restoredValue.length > 1000 ? "\n… preview shortened" : ""}</pre>
              </details>
              <div className="cbb-recovery-conflict__actions">
                <Button disabled={disabled} onClick={() => {
                  const nextError = onCommit(restoredValue);
                  if (nextError === undefined) {
                    setValue(restoredValue);
                    setError(undefined);
                    dirty.current = false;
                    canonical.current = restoredValue;
                    setRecoveryConflict(undefined);
                    publish("committed", restoredValue);
                  } else {
                    setValue(restoredValue);
                    setError(nextError);
                    dirty.current = true;
                    setRecoveryConflict(undefined);
                    publish("invalid", restoredValue, nextError);
                  }
                }}>Keep recovered text</Button>
                <Button onClick={() => {
                  setValue(canonical.current);
                  setError(undefined);
                  dirty.current = false;
                  setRecoveryConflict(undefined);
                  publish("discarded", canonical.current);
                  bufferBaseRevision.current = baseDocumentRevision;
                  bufferBaseResourceRevisionToken.current = baseResourceRevisionToken;
                  bufferBaseCanonicalHash.current = inspectorCanonicalValueHash(canonical.current);
                }}>Discard recovered text</Button>
                <Button disabled={disabled} onClick={() => {
                  setValue(restoredValue);
                  setError(restoredError);
                  dirty.current = true;
                  setRecoveryConflict(undefined);
                }}>Review and fix</Button>
              </div>
            </div>
          )}
      {multiline
        ? <textarea {...common} rows={5} />
        : <input {...common} type={type} {...(min === undefined ? {} : { min })} {...(max === undefined ? {} : { max })} {...(step === undefined ? {} : { step })} />}
      {description === undefined && disabledReason === undefined
        ? null
        : <p id={descriptionId} className="cbb-field-help">{disabled ? disabledReason : description}</p>}
      {error === undefined ? null : <p id={errorId} className="cbb-field-error" role="alert">{error}</p>}
    </div>
  );
}

function bufferedRestoration(
  props: InspectorPanelProps,
  controlId: string,
): Pick<BufferedControlProps, "baseResourceRevisionToken" | "restoredValue" | "restoredBaseDocumentRevision" | "restoredBaseResourceRevisionToken" | "restoredBaseCanonicalHash" | "restoredError" | "restoredStatus" | "restoredRecoveryConflict"> {
  const restored = props.restoredEditBuffers?.[controlId];
  const baseResourceRevisionToken = props.documentRevisionToken ?? null;
  if (restored === undefined) return { baseResourceRevisionToken };
  if (typeof restored === "string") return { baseResourceRevisionToken, restoredValue: restored };
  return {
    baseResourceRevisionToken,
    restoredValue: restored.value,
    ...(restored.baseDocumentRevision === undefined
      ? {}
      : { restoredBaseDocumentRevision: restored.baseDocumentRevision }),
    ...(restored.baseResourceRevisionToken === undefined
      ? {}
      : { restoredBaseResourceRevisionToken: restored.baseResourceRevisionToken }),
    ...(restored.baseCanonicalHash === undefined
      ? {}
      : { restoredBaseCanonicalHash: restored.baseCanonicalHash }),
    ...(restored.error === undefined ? {} : { restoredError: restored.error }),
    ...(restored.status === undefined ? {} : { restoredStatus: restored.status }),
    ...(restored.recoveryConflict === undefined
      ? {}
      : { restoredRecoveryConflict: restored.recoveryConflict }),
  };
}

function commandResult(store: EditorStore, command: EditorCommand): string | undefined {
  try {
    const result = store.execute(command);
    return result.status === "denied" ? result.denial.reason : undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "That value could not be applied.";
  }
}

function normalizedLength(
  value: string,
  options: { readonly allowAuto?: boolean; readonly allowRelative?: boolean } = {},
): string {
  const normalized = value.normalize("NFC").trim();
  let parsed: ReturnType<typeof parseLength>;
  try {
    parsed = parseLength(normalized);
  } catch {
    throw new Error(options.allowAuto === true
      ? "Use a physical length such as 1in or 72pt, a percentage, or auto."
      : "Use a physical length such as 1in or 72pt.");
  }
  if (parsed.kind === "auto" && options.allowAuto === true) return normalized;
  if (parsed.kind === "absolute") {
    if (parsed.pt.numerator < 0n) throw new Error("Enter a length of zero or more.");
    return normalized;
  }
  if (options.allowRelative === true && (parsed.kind === "percent" || parsed.kind === "em")) {
    if (parsed.value.numerator < 0n) throw new Error("Enter a length of zero or more.");
    return normalized;
  }
  throw new Error(options.allowAuto === true
    ? "Use a physical length such as 1in or 72pt, a percentage, or auto."
    : "Use a physical length such as 1in or 72pt.");
}

function normalizedColor(value: string): string {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (normalized === "transparent" || /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u.test(normalized)) {
    return normalized;
  }
  throw new Error("Enter a color such as #1f2937 or transparent.");
}

interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

function parsedColor(value: string): RgbaColor | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 };
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/u.exec(normalized);
  if (match?.[1] === undefined) return undefined;
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16),
    green: Number.parseInt(match[1].slice(2, 4), 16),
    blue: Number.parseInt(match[1].slice(4, 6), 16),
    alpha: match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255,
  };
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) return { red: 255, green: 255, blue: 255, alpha: 1 };
  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
    alpha,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

function contrastRatio(text: string, background: string, pageBackground: string): number | undefined {
  const white = { red: 255, green: 255, blue: 255, alpha: 1 } as const;
  const page = parsedColor(pageBackground);
  const fill = parsedColor(background);
  const foreground = parsedColor(text);
  if (page === undefined || fill === undefined || foreground === undefined) return undefined;
  const opaquePage = compositeColor(page, white);
  const opaqueFill = compositeColor(fill, opaquePage);
  const opaqueText = compositeColor(foreground, opaqueFill);
  const textLuminance = relativeLuminance(opaqueText);
  const fillLuminance = relativeLuminance(opaqueFill);
  return (Math.max(textLuminance, fillLuminance) + 0.05) /
    (Math.min(textLuminance, fillLuminance) + 0.05);
}

function currentBufferedValue(props: InspectorPanelProps, controlId: string, canonical: string): string {
  const value = props.restoredEditBuffers?.[controlId];
  return value === undefined ? canonical : typeof value === "string" ? value : value.value;
}

function headingOrderFindings(document: CbbDocument): readonly string[] {
  const headings: { readonly level: number; readonly elementName: string }[] = [];
  const visit = (element: NativeElement): void => {
    if (
      element.type === "text" &&
      element.data.content?.kind === "richText" &&
      element.data.content.document !== undefined
    ) {
      for (const block of element.data.content.document.blocks) {
        if (block.type === "heading") headings.push({ level: block.level, elementName: element.name });
      }
    }
    if (element.type === "music" && element.data.richContent !== undefined) {
      for (const block of element.data.richContent.blocks) {
        if (block.type === "heading") headings.push({ level: block.level, elementName: element.name });
      }
    }
    if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
      for (const child of element.children) visit(child.element);
    }
  };
  for (const element of document.elements) visit(element);
  let previous = 0;
  const findings: string[] = [];
  for (const heading of headings) {
    if (heading.level > previous + 1) {
      findings.push(previous === 0
        ? `${heading.elementName} starts at Heading ${heading.level}; begin the document outline with Heading 1.`
        : `${heading.elementName} jumps from Heading ${previous} to Heading ${heading.level}; do not skip a heading level.`);
    }
    previous = heading.level;
  }
  return findings;
}

function normalizedFraction(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("Enter a number from 0 through 1.");
  }
  return parsed;
}

function physicalInches(value: NativeElement["width"] | undefined): number | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (typeof value === "number") return value / 96;
  try {
    const parsed = parseLength(value);
    return parsed.kind === "absolute" ? Number(lengthToEditorPixels(parsed)) / 96 : undefined;
  } catch {
    return undefined;
  }
}

function selectedText(element: Extract<NativeElement, { type: "text" }>): string {
  const content = element.data.content;
  if (content === undefined) return "";
  return content.kind === "plain"
    ? content.text ?? ""
    : content.document === undefined ? "" : plainText(content.document);
}

function nestedElement(root: NativeElement, nodeId: NodeId): NativeElement | undefined {
  if (root.id === nodeId) return root;
  if (root.type !== "grid" && root.type !== "stack" && root.type !== "canvas") return undefined;
  for (const child of root.children) {
    const found = nestedElement(child.element, nodeId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Use effective bound data only when this source item has one unambiguous rendered occurrence. */
function uniqueResolvedElement(document: CbbDocument, nodeId: NodeId): NativeElement | undefined {
  const model = createEditorRenderModel(document);
  const occurrences = [
    ...model.elements.map((entry) => entry.element),
    ...model.pageElements.map((entry) => entry.wrapper.element),
  ].map((root) => nestedElement(root, nodeId)).filter(
    (element): element is NativeElement => element !== undefined,
  );
  return occurrences.length === 1 ? occurrences[0] : undefined;
}

function contentKindName(element: NativeElement): string {
  switch (element.type) {
    case "text": return "Text";
    case "image": return "Image";
    case "date": return "Date";
    case "music": return "Hymn or song";
    case "rightsAttribution": return "Copyrights & Permissions";
    case "grid": return "Grid";
    case "stack": return "Stack";
    case "canvas": return "Canvas";
    case "pageBreak": return "Page break";
    case "customInstance": return TASK_LANGUAGE.savedSection;
  }
}

function PanelSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className="cbb-inspector-section"><h3>{title}</h3>{children}</section>;
}

function ContentPanel(props: InspectorPanelProps & { readonly element?: NativeElement | undefined }) {
  const { element } = props;
  if (element === undefined) {
    const decision = checkEditorCapability(props.document, props.mode, {
      capability: "template.editLifecycle",
      target: { kind: "document" },
    });
    const disabled = !decision.allowed;
    const reason = decision.allowed ? undefined : decision.reason;
    const scripture = {
      referencePlacement: "before" as const,
      verseNumberStyle: "superscript" as const,
      paragraphPolicy: "publisher" as const,
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference" as const,
      ...props.document.scripturePresentation,
    };
    const contexts = props.document.publicationContexts ?? ["printedNonsalableChurchBulletin"];
    const scriptureTypography = scripture.typographyPresetSnapshot === undefined
      ? "inherit"
      : scriptureTypographyPresetId(scripture.typographyPresetSnapshot) ?? "unsupported";
    const apply = (input: {
      readonly scripturePresentation?: CbbDocument["scripturePresentation"];
      readonly rightsPolicy?: CbbDocument["rightsPolicy"];
      readonly publicationContexts?: CbbDocument["publicationContexts"];
    }) => commandResult(props.store, createSetDocumentPublicationSettingsCommand({
      scripturePresentation: input.scripturePresentation ?? scripture,
      rightsPolicy: input.rightsPolicy ?? props.document.rightsPolicy ?? { unknownRightsPolicy: "review" },
      publicationContexts: input.publicationContexts ?? contexts,
    }));
    return (
      <>
        <PanelSection title="Bulletin">
          <p>Select an item on the page or in Structure to edit its content.</p>
          {disabled ? <p className="cbb-field-help">{reason}</p> : null}
        </PanelSection>
        <PanelSection title="How this bulletin is usually shared">
          <p className="cbb-field-help">These choices prepare future rights review. Choose every normal use.</p>
          {([
            ["printedNonsalableChurchBulletin", "Print copies"],
            ["digitalNonsalableChurchBulletin", "Share the PDF by email or online"],
          ] as const).map(([value, label]) => {
            const checked = contexts.includes(value);
            return (
              <label key={value} className="cbb-choice-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (checked && contexts.length === 1)}
                  title={disabled ? reason : checked && contexts.length === 1 ? "Keep at least one sharing choice." : undefined}
                  onChange={(event) => apply({
                    publicationContexts: event.currentTarget.checked
                      ? [...contexts, value]
                      : contexts.filter((entry) => entry !== value),
                  })}
                />
                {label}
              </label>
            );
          })}
          <label className="cbb-inspector-field">
            When a song or source has uncertain permission
            <select
              value={props.document.rightsPolicy?.unknownRightsPolicy ?? "review"}
              disabled={disabled}
              title={reason}
              onChange={(event) => apply({ rightsPolicy: {
                unknownRightsPolicy: event.currentTarget.value as "review" | "block",
              } })}
            >
              <option value="review">Show it for review</option>
              <option value="block">Mark it as blocking until resolved</option>
            </select>
          </label>
        </PanelSection>
        <PanelSection title="Scripture formatting">
          <label className="cbb-inspector-field">
            Reference placement
            <select
              value={scripture.referencePlacement}
              disabled={disabled}
              title={reason}
              onChange={(event) => apply({ scripturePresentation: {
                ...scripture,
                referencePlacement: event.currentTarget.value as "before" | "after",
              } })}
            >
              <option value="before">Before the passage</option>
              <option value="after">After the passage</option>
            </select>
          </label>
          <label className="cbb-inspector-field">
            Verse numbers
            <select
              value={scripture.verseNumberStyle}
              disabled={disabled}
              title={reason}
              onChange={(event) => apply({ scripturePresentation: {
                ...scripture,
                verseNumberStyle: event.currentTarget.value as "inline" | "superscript" | "hidden",
              } })}
            >
              <option value="superscript">Raised numbers</option>
              <option value="inline">Inline numbers</option>
              <option value="hidden">Hide verse numbers</option>
            </select>
          </label>
          <label className="cbb-inspector-field">
            Paragraphs
            <select
              value={scripture.paragraphPolicy}
              disabled={disabled}
              title={reason}
              onChange={(event) => apply({ scripturePresentation: {
                ...scripture,
                paragraphPolicy: event.currentTarget.value as "publisher" | "oneVerse",
              } })}
            >
              <option value="publisher">Keep source paragraphs</option>
              <option value="oneVerse">Start each verse on a new line</option>
            </select>
          </label>
          <label className="cbb-inspector-field">
            Translation label
            <select
              value={scripture.translationLabelPlacement}
              disabled={disabled}
              title={reason}
              onChange={(event) => apply({ scripturePresentation: {
                ...scripture,
                translationLabelPlacement: event.currentTarget.value as "withReference" | "afterPassage" | "hidden",
              } })}
            >
              <option value="withReference">With the reference</option>
              <option value="afterPassage">After the passage</option>
              <option value="hidden">Hide the label</option>
            </select>
          </label>
          <label className="cbb-inspector-field">
            Scripture typography
            <select
              value={scriptureTypography}
              disabled={disabled}
              title={reason}
              onChange={(event) => {
                const { typographyPresetSnapshot: _priorTypography, ...withoutTypography } = scripture;
                const preset = event.currentTarget.value;
                apply({ scripturePresentation: preset === "inherit"
                  ? withoutTypography
                  : {
                      ...withoutTypography,
                      typographyPresetSnapshot: scriptureTypographyPresetSnapshot(
                        preset as "readable" | "compact",
                      ) as unknown as Readonly<Record<string, unknown>>,
                    } });
              }}
            >
              <option value="inherit">Match surrounding text</option>
              <option value="readable">Comfortable reading</option>
              <option value="compact">Compact passage</option>
              {scriptureTypography === "unsupported" ? (
                <option value="unsupported" disabled>Unsupported saved choice</option>
              ) : null}
            </select>
          </label>
          <BufferedControl
            controlId="inspector-scripture-paragraph-spacing"
            label="Space between Scripture paragraphs"
            canonicalValue={scripture.paragraphSpacing}
            baseDocumentRevision={props.documentRevision}
            {...bufferedRestoration(props, "inspector-scripture-paragraph-spacing")}
            onBuffer={props.onEditBufferChange}
            disabled={disabled}
            disabledReason={reason}
            onCommit={(value) => {
              try {
                return apply({ scripturePresentation: {
                  ...scripture,
                  paragraphSpacing: normalizedLength(value),
                } });
              } catch (error) {
                return error instanceof Error ? error.message : "Enter a physical spacing value.";
              }
            }}
          />
          <p className="cbb-field-help">Choose surrounding text, a slightly larger reading style, or a compact style for long passages.</p>
        </PanelSection>
      </>
    );
  }
  const contentDecision = checkEditorCapability(props.document, props.mode, {
    capability: "content.edit",
    target: { kind: "node", nodeId: element.id },
  });
  const disabledReason = contentDecision.allowed ? undefined : contentDecision.reason;
  const previewElement = uniqueResolvedElement(props.document, element.id);
  if (element.type === "text") {
    const previewText = previewElement?.type === "text" ? previewElement : element;
    const richText = previewText.data.content?.kind === "richText";
    return (
      <PanelSection title="Text">
        <BufferedControl
          controlId={`inspector-${element.id}-text`}
          label="Text"
          canonicalValue={selectedText(previewText)}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, `inspector-${element.id}-text`)}
          onBuffer={props.onEditBufferChange}
          multiline
          disabled={!contentDecision.allowed || richText}
          disabledReason={richText
            ? "This item contains rich formatting. Edit it directly on the page so headings, lists, links, and Scripture remain intact."
            : disabledReason}
          description="Press Ctrl+Enter to apply while staying in this field."
          onCommit={(value) => {
            if (previewText.data.content?.kind === "richText") {
              return "Edit rich text directly on the page to preserve its formatting.";
            }
            const content: TextContent = { kind: "plain", text: value.normalize("NFC") };
            return commandResult(props.store, createSetTextContentCommand({ nodeId: element.id, content }));
          }}
        />
      </PanelSection>
    );
  }
  if (element.type === "date") {
    const previewDate = previewElement?.type === "date" ? previewElement : element;
    const presentationDecision = checkEditorCapability(props.document, props.mode, {
      capability: "layout.edit",
      target: { kind: "node", nodeId: element.id },
    });
    const presentationReason = presentationDecision.allowed ? undefined : presentationDecision.reason;
    const dateFormat = previewDate.data.format ?? "MMMM D, YYYY";
    const dateValue = previewDate.data.value ?? "";
    const namedFormats = [
      ["dddd, MMMM D, YYYY", "Full weekday and date"],
      ["MMMM D, YYYY", "Month, day, and year"],
      ["MMM D, YYYY", "Short month, day, and year"],
      ["MM/DD/YYYY", "Numeric month/day/year"],
    ] as const;
    const namedValue = namedFormats.some(([format]) => format === dateFormat)
      ? dateFormat
      : "custom";
    let example: string;
    try {
      example = dateValue === ""
        ? "Enter this week's date to see an example."
        : formatIsoDate(dateValue, dateFormat, previewDate.data.locale).text;
    } catch {
      example = "Choose or correct the format to see an example.";
    }
    return (
      <PanelSection title="Date">
        <BufferedControl
          controlId={`inspector-${element.id}-date`}
          label="Date"
          type="date"
          canonicalValue={dateValue}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, `inspector-${element.id}-date`)}
          onBuffer={props.onEditBufferChange}
          disabled={!contentDecision.allowed}
          disabledReason={disabledReason}
          onCommit={(value) => commandResult(props.store, createSetDateValueCommand({ nodeId: element.id, value }))}
        />
        <div className="cbb-inspector-field">
          <label htmlFor={`inspector-${element.id}-date-format-preset`}>Date style</label>
          <select
            id={`inspector-${element.id}-date-format-preset`}
            value={namedValue}
            disabled={!presentationDecision.allowed}
            title={presentationReason}
            onChange={(event) => {
              if (event.currentTarget.value === "custom") return;
              commandResult(props.store, createSetDatePresentationCommand({
                nodeId: element.id,
                format: event.currentTarget.value,
              }));
            }}
          >
            {namedFormats.map(([format, label]) => <option key={format} value={format}>{label}</option>)}
            {namedValue === "custom" ? <option value="custom">Custom style</option> : null}
          </select>
          <small>Example: {example}</small>
        </div>
        <details>
          <summary>Advanced date format</summary>
          <BufferedControl
            controlId={`inspector-${element.id}-date-format`}
            label="Format pattern"
            canonicalValue={dateFormat}
            baseDocumentRevision={props.documentRevision}
            {...bufferedRestoration(props, `inspector-${element.id}-date-format`)}
            onBuffer={props.onEditBufferChange}
            disabled={!presentationDecision.allowed}
            disabledReason={presentationReason}
            description="Use supported date tokens such as dddd, MMMM, MMM, D, DD, and YYYY."
            onCommit={(value) => {
              try {
                formatIsoDate(dateValue === "" ? "2000-01-01" : dateValue, value, previewDate.data.locale);
                return commandResult(props.store, createSetDatePresentationCommand({
                  nodeId: element.id,
                  format: value,
                }));
              } catch (error) {
                return error instanceof Error ? error.message : "Enter a supported date format.";
              }
            }}
          />
        </details>
      </PanelSection>
    );
  }
  if (element.type === "image") {
    const previewImage = previewElement?.type === "image" ? previewElement : element;
    const location = findElementLocation(props.document, element.id);
    const widthValue = location?.parent.kind === "page"
      ? location.parent.wrapper.width
      : element.width;
    const heightValue = location?.parent.kind === "page"
      ? location.parent.wrapper.height
      : element.height;
    const widthInches = physicalInches(widthValue);
    const heightInches = physicalInches(heightValue);
    const assetRef = previewImage.data.assetRef;
    const info = assetRef === undefined ? undefined : props.assetInfo?.(assetRef);
    const effectivePpi = info?.kind === "raster" &&
      info.pixelWidth !== undefined && info.pixelHeight !== undefined &&
      widthInches !== undefined && heightInches !== undefined &&
      widthInches > 0 && heightInches > 0
      ? Math.floor(Math.min(info.pixelWidth / widthInches, info.pixelHeight / heightInches))
      : undefined;
    const cropDecision = checkEditorCapability(props.document, props.mode, {
      capability: "content.adjustImageCrop",
      target: { kind: "node", nodeId: element.id },
    });
    const replaceDecision = checkEditorCapability(props.document, props.mode, {
      capability: "content.replaceImage",
      target: { kind: "node", nodeId: element.id },
    });
    const source = assetRef === undefined ? undefined : props.assetUrl?.(assetRef);
    return (
      <>
        <PanelSection title="Image">
          {source === undefined
            ? <div className="cbb-inspector-thumbnail cbb-inspector-thumbnail--missing">Image preview unavailable</div>
            : (
              previewImage.data.fit === "cover" &&
                widthInches !== undefined && heightInches !== undefined
                ? (
                    <CoverFocalImage
                      source={source}
                      alt="Selected image crop preview"
                      focalX={previewImage.data.focalPoint?.x ?? 0.5}
                      focalY={previewImage.data.focalPoint?.y ?? 0.5}
                      className="cbb-inspector-crop-preview"
                      imageClassName="cbb-inspector-thumbnail"
                      style={widthInches === undefined || heightInches === undefined
                        ? undefined
                        : { aspectRatio: `${widthInches} / ${heightInches}` }}
                    />
                  )
                : (
                    <div
                      className="cbb-inspector-crop-preview"
                      style={widthInches === undefined || heightInches === undefined
                        ? undefined
                        : { aspectRatio: `${widthInches} / ${heightInches}` }}
                    >
                      <img
                        className="cbb-inspector-thumbnail"
                        src={source}
                        alt="Selected image crop preview"
                        style={{ objectFit: "contain" }}
                      />
                    </div>
                  )
            )}
          <p className="cbb-asset-reference">{info?.displayName ?? "Managed image · details unavailable"}</p>
          {info?.kind === "vector"
            ? <p className="cbb-field-help">Vector image — print resolution does not apply.</p>
            : effectivePpi === undefined
              ? <p className="cbb-field-help">Effective print resolution is available when pixel and layout dimensions are known.</p>
              : (
                <p className={effectivePpi < 150 ? "cbb-image-resolution is-warning" : "cbb-image-resolution is-good"}>
                  Effective print resolution: {effectivePpi} PPI{effectivePpi < 150 ? " — low for print; replace it or reduce its layout size." : " — suitable for print."}
                </p>
              )}
          <Button
            variant="primary"
            disabled={!replaceDecision.allowed || props.onRequestImageReplacement === undefined || assetRef === undefined}
            title={!replaceDecision.allowed
              ? replaceDecision.reason
              : props.onRequestImageReplacement === undefined
                ? props.imageLibraryUnavailableReason ?? "Image library is not connected in this view."
                : undefined}
            onClick={() => {
              if (assetRef !== undefined) props.onRequestImageReplacement?.(element.id, assetRef);
              props.onAnnouncement?.("After choosing the replacement, review whether its image description is still accurate.");
            }}
          >
            Replace image
          </Button>
          {props.onRequestImageReplacement === undefined
            ? <p className="cbb-field-help">{props.imageLibraryUnavailableReason ?? "Image replacement is unavailable in this view."}</p>
            : null}
        </PanelSection>
        <PanelSection title="Fit and crop">
          <div className="cbb-inspector-field">
            <label htmlFor={`inspector-${element.id}-fit`}>Image fit</label>
            <select
              id={`inspector-${element.id}-fit`}
              value={previewImage.data.fit}
              disabled={!cropDecision.allowed}
              title={cropDecision.allowed ? undefined : cropDecision.reason}
              onChange={(event) => {
                commandResult(props.store, createSetImageFitCommand({
                  nodeId: element.id,
                  fit: event.currentTarget.value as "contain" | "cover",
                }));
              }}
            >
              <option value="contain">Fit whole image</option>
              <option value="cover">Crop to fill</option>
            </select>
          </div>
          {previewImage.data.fit === "cover"
            ? (
              <details className="cbb-crop-adjuster">
                <summary>Adjust crop</summary>
                <p className="cbb-field-help">The preview uses this image’s exact destination aspect ratio.</p>
                <div className="cbb-focal-grid" role="group" aria-label="Crop focal point">
                  {(["x", "y"] as const).map((axis) => (
                    <BufferedControl
                      key={axis}
                      controlId={`inspector-${element.id}-focal-${axis}`}
                      label={`${axis.toUpperCase()} focal point`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      canonicalValue={String(previewImage.data.focalPoint?.[axis] ?? 0.5)}
                      baseDocumentRevision={props.documentRevision}
                      {...bufferedRestoration(props, `inspector-${element.id}-focal-${axis}`)}
                      onBuffer={props.onEditBufferChange}
                      disabled={!cropDecision.allowed}
                      disabledReason={cropDecision.allowed ? undefined : cropDecision.reason}
                      description="0 is the top or left edge; 1 is the bottom or right edge."
                      onCommit={(value) => {
                        try {
                          const focalPoint = {
                            x: axis === "x" ? normalizedFraction(value) : previewImage.data.focalPoint?.x ?? 0.5,
                            y: axis === "y" ? normalizedFraction(value) : previewImage.data.focalPoint?.y ?? 0.5,
                          };
                          return commandResult(props.store, createSetImageFocalPointCommand({ nodeId: element.id, focalPoint }));
                        } catch (error) {
                          return error instanceof Error ? error.message : "Enter a number from 0 through 1.";
                        }
                      }}
                    />
                  ))}
                </div>
              </details>
            )
            : null}
        </PanelSection>
      </>
    );
  }
  if (element.type === "rightsAttribution") {
    const previewRights = previewElement?.type === "rightsAttribution" ? previewElement : element;
    const decision = checkEditorCapability(props.document, props.mode, {
      capability: "template.editLifecycle",
      target: { kind: "node", nodeId: element.id },
    });
    const disabled = !decision.allowed;
    const reason = decision.allowed ? undefined : decision.reason;
    const update = (input: Partial<{
      readonly heading: string;
      readonly groupOrder: readonly ["scripture" | "music" | "other", "scripture" | "music" | "other", "scripture" | "music" | "other"];
      readonly includePublicDomainLines: boolean;
    }>) => commandResult(props.store, createSetRightsAttributionOptionsCommand({
      nodeId: element.id,
      heading: input.heading ?? previewRights.data.heading ?? "Copyrights & Permissions",
      groupOrder: input.groupOrder ?? previewRights.data.groupOrder,
      sortPolicy: "firstAppearance",
      includePublicDomainLines: input.includePublicDomainLines ??
        previewRights.data.includePublicDomainLines ?? false,
    }));
    const groupPreset = previewRights.data.groupOrder[0] === "music"
      ? "music"
      : previewRights.data.groupOrder[0] === "other" ? "other" : "scripture";
    return (
      <>
        <PanelSection title="Generated credits">
          <p>Credit lines come from Scripture and songs used in this bulletin. Edit the source item to change an individual line.</p>
        </PanelSection>
        <PanelSection title="Copyrights & Permissions settings">
          <BufferedControl
            controlId={`inspector-${element.id}-rights-heading`}
            label="Heading"
            canonicalValue={previewRights.data.heading ?? "Copyrights & Permissions"}
            baseDocumentRevision={props.documentRevision}
            {...bufferedRestoration(props, `inspector-${element.id}-rights-heading`)}
            onBuffer={props.onEditBufferChange}
            disabled={disabled}
            disabledReason={reason}
            onCommit={(value) => update({ heading: value })}
          />
          <label className="cbb-inspector-field">
            Credit group shown first
            <select
              value={groupPreset}
              disabled={disabled}
              title={reason}
              onChange={(event) => {
                const first = event.currentTarget.value as "scripture" | "music" | "other";
                const rest = (["scripture", "music", "other"] as const).filter((group) => group !== first);
                update({ groupOrder: [first, rest[0]!, rest[1]!] });
              }}
            >
              <option value="scripture">Scripture</option>
              <option value="music">Music</option>
              <option value="other">Other credits</option>
            </select>
          </label>
          <label className="cbb-choice-row">
            <input
              type="checkbox"
              checked={previewRights.data.includePublicDomainLines ?? false}
              disabled={disabled}
              title={reason}
              onChange={(event) => update({ includePublicDomainLines: event.currentTarget.checked })}
            />
            Show explicit public-domain lines
          </label>
        </PanelSection>
      </>
    );
  }
  if (element.type === "music") {
    return <PanelSection title="Hymn or song"><p><strong>{element.data.number === undefined ? "" : `${element.data.number} `}{element.data.title}</strong></p><p>This item does not have weekly content controls in this version.</p></PanelSection>;
  }
  if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
    return <PanelSection title={contentKindName(element)}><p>This section contains {element.children.length} item{element.children.length === 1 ? "" : "s"}. Use Structure to add or rearrange them.</p></PanelSection>;
  }
  return <PanelSection title={contentKindName(element)}><p>This item has no weekly content controls.</p></PanelSection>;
}

function PageLayoutPanel(props: InspectorPanelProps) {
  const decision = checkEditorCapability(props.document, props.mode, {
    capability: "layout.editPageSetup",
  });
  const disabled = !decision.allowed;
  const reason = decision.allowed ? undefined : decision.reason;
  const page = props.document.page;
  const marginMode = page.marginMode ?? "fixed";
  const marginSides = marginMode === "mirrored"
    ? (["top", "outer", "bottom", "inner"] as const)
    : (["top", "right", "bottom", "left"] as const);
  return (
    <>
      <PanelSection title="Finished page size">
        <div className="cbb-inspector-field">
          <label htmlFor="inspector-page-size-preset">Common size</label>
          <select
            id="inspector-page-size-preset"
            disabled={disabled}
            defaultValue="custom"
            title={reason}
            onChange={(event) => {
              const sizes = {
                letter: ["8.5in", "11in"],
                halfLetter: ["5.5in", "8.5in"],
                a4: ["210mm", "297mm"],
              } as const;
              const size = sizes[event.currentTarget.value as keyof typeof sizes];
              if (size !== undefined) commandResult(props.store, createSetFinishedPageSizeCommand({ width: size[0], height: size[1] }));
            }}
          >
            <option value="custom">Custom</option>
            <option value="letter">US Letter</option>
            <option value="halfLetter">Half Letter</option>
            <option value="a4">A4</option>
          </select>
        </div>
        <div className="cbb-inspector-pair">
          {(["width", "height"] as const).map((axis) => {
            const canonical = axis === "width" ? page.typstWidth : page.typstHeight;
            const id = `inspector-page-${axis}`;
            return (
              <BufferedControl
                key={axis}
                controlId={id}
                label={axis === "width" ? "Width" : "Height"}
                canonicalValue={canonical}
                baseDocumentRevision={props.documentRevision}
                {...bufferedRestoration(props, id)}
                onBuffer={props.onEditBufferChange}
                disabled={disabled}
                disabledReason={reason}
                onCommit={(value) => {
                  try {
                    const normalized = normalizedLength(value);
                    return commandResult(props.store, createSetFinishedPageSizeCommand({
                      width: axis === "width" ? normalized : page.typstWidth,
                      height: axis === "height" ? normalized : page.typstHeight,
                    }));
                  } catch (error) {
                    return error instanceof Error ? error.message : "Enter a physical length.";
                  }
                }}
              />
            );
          })}
        </div>
      </PanelSection>
      <PanelSection title="Margins">
        <div className="cbb-inspector-grid">
          {marginSides.map((side) => {
            const id = `inspector-page-margin-${side}`;
            const fallback = side === "top" || side === "bottom" ? "0.5in" : "0.65in";
            return (
              <BufferedControl
                key={side}
                controlId={id}
                label={`${side[0]?.toUpperCase() ?? ""}${side.slice(1)} margin`}
                canonicalValue={page.margins?.[side] ?? fallback}
                baseDocumentRevision={props.documentRevision}
                {...bufferedRestoration(props, id)}
                onBuffer={props.onEditBufferChange}
                disabled={disabled}
                disabledReason={reason}
                onCommit={(value) => {
                  try {
                    return commandResult(props.store, createSetPageMarginCommand({ side, value: normalizedLength(value) }));
                  } catch (error) {
                    return error instanceof Error ? error.message : "Enter a physical length.";
                  }
                }}
              />
            );
          })}
        </div>
      </PanelSection>
      <PanelSection title="Layout and fold">
        <div className="cbb-inspector-field">
          <label htmlFor="inspector-page-layout-intent">Page layout</label>
          <select
            id="inspector-page-layout-intent"
            value={page.layoutIntent ?? "singlePage"}
            disabled={disabled}
            title={reason}
            onChange={(event) => commandResult(props.store, createSetPageLayoutCommand({
              layoutIntent: event.currentTarget.value as "singlePage" | "foldedBooklet",
              marginMode,
              binding: page.binding ?? "left",
            }))}
          >
            <option value="singlePage">Single pages</option>
            <option value="foldedBooklet">Folded booklet</option>
          </select>
        </div>
        <div className="cbb-inspector-field">
          <label htmlFor="inspector-margin-mode">Margin layout</label>
          <select
            id="inspector-margin-mode"
            value={marginMode}
            disabled={disabled}
            title={reason}
            onChange={(event) => commandResult(props.store, createSetPageLayoutCommand({
              layoutIntent: page.layoutIntent ?? "singlePage",
              marginMode: event.currentTarget.value as "fixed" | "mirrored",
              binding: page.binding ?? "left",
            }))}
          >
            <option value="fixed">Same on every page</option>
            <option value="mirrored">Mirror inner and outer margins</option>
          </select>
        </div>
        {page.layoutIntent === "foldedBooklet" || marginMode === "mirrored"
          ? (
            <div className="cbb-inspector-field">
              <label htmlFor="inspector-page-binding">Booklet opens on</label>
              <select
                id="inspector-page-binding"
                value={page.binding ?? "left"}
                disabled={disabled}
                title={reason}
                onChange={(event) => commandResult(props.store, createSetPageLayoutCommand({
                  layoutIntent: page.layoutIntent ?? "singlePage",
                  marginMode,
                  binding: event.currentTarget.value as "left" | "right",
                }))}
              >
                <option value="left">Left side</option>
                <option value="right">Right side</option>
              </select>
            </div>
          )
          : null}
      </PanelSection>
    </>
  );
}

function ElementLayoutPanel(props: InspectorPanelProps & { readonly element: NativeElement }) {
  const { element } = props;
  const location = findElementLocation(props.document, element.id);
  const decision = checkEditorCapability(props.document, props.mode, {
    capability: "layout.edit",
    target: { kind: "node", nodeId: element.id },
  });
  const disabled = !decision.allowed;
  const reason = decision.allowed ? undefined : decision.reason;
  const resizeDecision = checkEditorCapability(props.document, props.mode, {
    capability: "layout.resize",
    target: {
      kind: "node",
      nodeId: location?.parent.kind === "page" ? location.parent.wrapper.id : element.id,
    },
  });
  const placementDecision = location?.parent.kind === "canvas" || location?.parent.kind === "page"
    ? checkEditorCapability(props.document, props.mode, {
        capability: "layout.editPlacement",
        target: { kind: "node", nodeId: location.parent.wrapper.id },
      })
    : undefined;
  return (
    <>
      <PanelSection title="Item">
        <BufferedControl
          controlId={`inspector-${element.id}-name`}
          label="Name in Structure"
          canonicalValue={element.name}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, `inspector-${element.id}-name`)}
          onBuffer={props.onEditBufferChange}
          disabled={disabled}
          disabledReason={reason}
          onCommit={(value) => commandResult(props.store, createSetElementNameCommand({ nodeId: element.id, name: value }))}
        />
        {element.type === "pageBreak"
          ? null
          : (
            <div className="cbb-inspector-pair">
              {(["width", "height"] as const).map((axis) => {
                const id = `inspector-${element.id}-${axis}`;
                const pageValue = location?.parent.kind === "page" ? location.parent.wrapper[axis] : undefined;
                const canonical = String(pageValue ?? element[axis] ?? "auto");
                return (
                  <BufferedControl
                    key={axis}
                    controlId={id}
                    label={axis === "width" ? "Width" : "Height"}
                    canonicalValue={canonical}
                    baseDocumentRevision={props.documentRevision}
                    {...bufferedRestoration(props, id)}
                    onBuffer={props.onEditBufferChange}
                    disabled={!resizeDecision.allowed}
                    disabledReason={resizeDecision.allowed ? undefined : resizeDecision.reason}
                    onCommit={(value) => {
                      try {
                        const normalized = normalizedLength(value, { allowAuto: true, allowRelative: true });
                        return commandResult(props.store, createResizeElementCommand({
                          nodeId: element.id,
                          ...(axis === "width" ? { width: normalized } : { height: normalized }),
                        }));
                      } catch (error) {
                        return error instanceof Error ? error.message : "Enter a valid size.";
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        {location?.parent.kind === "grid"
          ? <p className="cbb-readonly-placement">Grid position: row {location.parent.wrapper.row + 1}, column {location.parent.wrapper.column + 1}. Move it in Structure.</p>
          : null}
        {location?.parent.kind === "stack"
          ? <p className="cbb-readonly-placement">Section position: {location.parent.wrapper.index + 1}. Move it in Structure.</p>
          : null}
        {location?.parent.kind === "canvas" || location?.parent.kind === "page"
          ? (
            <fieldset className="cbb-fieldset">
              <legend>{location.parent.kind === "canvas" ? "Canvas position" : "Page position"}</legend>
              <div className="cbb-inspector-pair">
                {(["x", "y"] as const).map((axis) => {
                  const id = `inspector-${element.id}-position-${axis}`;
                  const parent = location.parent as Extract<ElementParent, { readonly kind: "canvas" | "page" }>;
                  return (
                    <BufferedControl
                      key={axis}
                      controlId={id}
                      label={axis.toUpperCase()}
                      canonicalValue={String(parent.wrapper[axis])}
                      baseDocumentRevision={props.documentRevision}
                      {...bufferedRestoration(props, id)}
                      onBuffer={props.onEditBufferChange}
                      disabled={placementDecision?.allowed === false}
                      disabledReason={placementDecision?.allowed === false ? placementDecision.reason : undefined}
                      onCommit={(value) => {
                        try {
                          const normalized = normalizedLength(value, { allowRelative: parent.kind === "page" });
                          if (parent.kind === "canvas") {
                            return commandResult(props.store, createMoveCanvasChildCommand({
                              nodeId: element.id,
                              x: axis === "x" ? normalized : parent.wrapper.x,
                              y: axis === "y" ? normalized : parent.wrapper.y,
                            }));
                          }
                          return commandResult(props.store, createMovePageElementCommand({
                            nodeId: element.id,
                            x: axis === "x" ? normalized : parent.wrapper.x,
                            y: axis === "y" ? normalized : parent.wrapper.y,
                          }));
                        } catch (error) {
                          return error instanceof Error ? error.message : "Enter a valid position.";
                        }
                      }}
                    />
                  );
                })}
              </div>
            </fieldset>
          )
          : null}
      </PanelSection>
      {element.type === "grid"
        ? (
          <PanelSection title="Columns and reading order">
            {(() => {
              const occupied = new Set(element.children.map((wrapper) => `${wrapper.row}:${wrapper.column}`));
              const tableReady = occupied.size === element.data.rows * element.data.columns;
              return <>
            <div className="cbb-inspector-field">
              <label htmlFor={`inspector-${element.id}-column-preset`}>Column widths</label>
              <select
                id={`inspector-${element.id}-column-preset`}
                value={element.data.columnTracks === undefined || element.data.columnTracks.every((track) => track === "1fr")
                  ? "equal"
                  : element.data.columnTracks.join(",")}
                disabled={disabled}
                title={reason}
                onChange={(event) => {
                  const preset = event.currentTarget.value;
                  const tracks = preset === "equal"
                    ? Array.from({ length: element.data.columns }, () => "1fr" as const)
                    : preset.split(",");
                  commandResult(props.store, createSetGridLayoutCommand({
                    nodeId: element.id,
                    columnTracks: tracks,
                  }));
                }}
              >
                <option value="equal">Equal columns</option>
                {element.data.columns === 2 ? <option value="2fr,1fr">Wide left column</option> : null}
                {element.data.columns === 2 ? <option value="1fr,2fr">Wide right column</option> : null}
                {element.data.columnTracks !== undefined &&
                !element.data.columnTracks.every((track) => track === "1fr") &&
                element.data.columnTracks.join(",") !== "2fr,1fr" &&
                element.data.columnTracks.join(",") !== "1fr,2fr"
                  ? <option value={element.data.columnTracks.join(",")}>Custom widths</option>
                  : null}
              </select>
            </div>
            <div className="cbb-inspector-pair">
              {(["rowGap", "columnGap"] as const).map((property) => {
                const id = `inspector-${element.id}-${property}`;
                return (
                  <BufferedControl
                    key={property}
                    controlId={id}
                    label={property === "rowGap" ? "Row gap" : "Column gap"}
                    canonicalValue={String(element.data[property] ?? element.data.cellPadding ?? 0)}
                    baseDocumentRevision={props.documentRevision}
                    {...bufferedRestoration(props, id)}
                    onBuffer={props.onEditBufferChange}
                    disabled={disabled}
                    disabledReason={reason}
                    onCommit={(value) => {
                      try {
                        return commandResult(props.store, createSetGridLayoutCommand({
                          nodeId: element.id,
                          [property]: normalizedLength(value),
                        }));
                      } catch (error) {
                        return error instanceof Error ? error.message : "Enter a valid gap.";
                      }
                    }}
                  />
                );
              })}
            </div>
            <div className="cbb-inspector-field">
              <label htmlFor={`inspector-${element.id}-semantic-role`}>This grid is</label>
              <select
                id={`inspector-${element.id}-semantic-role`}
                value={element.data.semanticRole ?? "layout"}
                disabled={disabled}
                title={reason}
                onChange={(event) => {
                  const semanticRole = event.currentTarget.value as "layout" | "table";
                  commandResult(props.store, createSetGridLayoutCommand({
                    nodeId: element.id,
                    semanticRole,
                    ...(semanticRole === "table"
                      ? {
                          tableSemantics: element.data.tableSemantics ?? {
                            summary: "Describe this table",
                            headerRows: 1,
                            headerColumns: 0,
                          },
                        }
                      : {}),
                  }));
                }}
              >
                <option value="layout">Layout columns</option>
                <option value="table" disabled={!tableReady}>Tabular data</option>
              </select>
              {!tableReady
                ? <small>Fill every grid cell before using table reading semantics.</small>
                : null}
            </div>
            {element.data.semanticRole === "table"
              ? (
                <>
                  <BufferedControl
                    controlId={`inspector-${element.id}-table-summary`}
                    label="Table summary"
                    canonicalValue={element.data.tableSemantics?.summary ?? ""}
                    baseDocumentRevision={props.documentRevision}
                    {...bufferedRestoration(props, `inspector-${element.id}-table-summary`)}
                    onBuffer={props.onEditBufferChange}
                    disabled={disabled}
                    disabledReason={reason}
                    description="Briefly explain what readers should learn from this table."
                    onCommit={(value) => commandResult(props.store, createSetGridLayoutCommand({
                      nodeId: element.id,
                      tableSemantics: {
                        summary: value.normalize("NFC").trim(),
                        headerRows: element.data.tableSemantics?.headerRows ?? 1,
                        headerColumns: element.data.tableSemantics?.headerColumns ?? 0,
                      },
                    }))}
                  />
                  <div className="cbb-inspector-pair">
                    {([
                      ["headerRows", "Header rows", element.data.rows],
                      ["headerColumns", "Header columns", element.data.columns],
                    ] as const).map(([property, label, maximum]) => {
                      const semantics = element.data.tableSemantics ?? {
                        summary: "Describe this table",
                        headerRows: 1,
                        headerColumns: 0,
                      };
                      const other = property === "headerRows"
                        ? semantics.headerColumns
                        : semantics.headerRows;
                      return (
                        <div className="cbb-inspector-field" key={property}>
                          <label htmlFor={`inspector-${element.id}-${property}`}>{label}</label>
                          <select
                            id={`inspector-${element.id}-${property}`}
                            value={semantics[property]}
                            disabled={disabled}
                            title={reason}
                            onChange={(event) => commandResult(props.store, createSetGridLayoutCommand({
                              nodeId: element.id,
                              tableSemantics: {
                                ...semantics,
                                [property]: Number(event.currentTarget.value),
                              },
                            }))}
                          >
                            {Array.from({ length: maximum + 1 }, (_, value) => (
                              <option key={value} value={value} disabled={value === 0 && other === 0}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </>
              )
              : null}
              </>;
            })()}
          </PanelSection>
        )
        : null}
      {element.type === "stack"
        ? (
          <PanelSection title="Section arrangement">
            <div className="cbb-inspector-field">
              <label htmlFor={`inspector-${element.id}-stack-direction`}>Arrange items</label>
              <select
                id={`inspector-${element.id}-stack-direction`}
                value={element.data.direction}
                disabled={disabled}
                title={reason}
                onChange={(event) => commandResult(props.store, createSetStackLayoutCommand({
                  nodeId: element.id,
                  direction: event.currentTarget.value as "vertical" | "horizontal",
                }))}
              >
                <option value="vertical">Top to bottom</option>
                <option value="horizontal">Side by side</option>
              </select>
            </div>
            <BufferedControl
              controlId={`inspector-${element.id}-stack-gap`}
              label="Space between items"
              canonicalValue={String(element.data.gap)}
              baseDocumentRevision={props.documentRevision}
              {...bufferedRestoration(props, `inspector-${element.id}-stack-gap`)}
              onBuffer={props.onEditBufferChange}
              disabled={disabled}
              disabledReason={reason}
              onCommit={(value) => {
                try {
                  return commandResult(props.store, createSetStackLayoutCommand({
                    nodeId: element.id,
                    gap: normalizedLength(value),
                  }));
                } catch (error) {
                  return error instanceof Error ? error.message : "Enter a valid space between items.";
                }
              }}
            />
          </PanelSection>
        )
        : null}
      {location?.parent.kind === "page"
        ? null
        : (
          <PanelSection title="Spacing and page breaks">
            <div className="cbb-inspector-pair">
              {(["margin", "padding"] as const).map((property) => {
                const id = `inspector-${element.id}-${property}`;
                return (
                  <BufferedControl
                    key={property}
                    controlId={id}
                    label={property === "margin" ? "Outer spacing" : "Inner spacing"}
                    canonicalValue={String(element[property] ?? "0pt")}
                    baseDocumentRevision={props.documentRevision}
                    {...bufferedRestoration(props, id)}
                    onBuffer={props.onEditBufferChange}
                    disabled={disabled}
                    disabledReason={reason}
                    onCommit={(value) => {
                      try {
                        return commandResult(props.store, createSetElementSpacingCommand({
                          nodeId: element.id,
                          property,
                          value: normalizedLength(value),
                        }));
                      } catch (error) {
                        return error instanceof Error ? error.message : "Enter a physical length.";
                      }
                    }}
                  />
                );
              })}
            </div>
            <div className="cbb-inspector-field">
              <label htmlFor={`inspector-${element.id}-break`}>Keep together across pages</label>
              <select
                id={`inspector-${element.id}-break`}
                value={element.breakPolicy ?? "auto"}
                disabled={disabled}
                title={reason}
                onChange={(event) => commandResult(props.store, createSetElementBreakPolicyCommand({
                  nodeId: element.id,
                  breakPolicy: event.currentTarget.value as "auto" | "avoid",
                }))}
              >
                <option value="auto">Allow natural page breaks</option>
                <option value="avoid">Keep together when it fits</option>
              </select>
            </div>
          </PanelSection>
        )}
    </>
  );
}

function AppearancePanel(props: InspectorPanelProps & { readonly element?: NativeElement | undefined }) {
  const { element } = props;
  const pageDecision = checkEditorCapability(props.document, props.mode, {
    capability: "layout.editPageSetup",
  });
  const disabled = !pageDecision.allowed;
  const reason = pageDecision.allowed ? undefined : pageDecision.reason;
  if (element === undefined) {
    const id = "inspector-page-background";
    return (
      <PanelSection title="Page color">
        <BufferedControl
          controlId={id}
          label="Background color"
          canonicalValue={props.document.page.background ?? "#ffffff"}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, id)}
          onBuffer={props.onEditBufferChange}
          disabled={disabled}
          disabledReason={reason}
          description="Choose an exact six-digit color. Contrast is checked during review."
          onCommit={(value) => {
            try {
              return commandResult(props.store, createSetPageAppearanceCommand({ background: normalizedColor(value) }));
            } catch (error) {
              return error instanceof Error ? error.message : "Enter a valid color.";
            }
          }}
        />
      </PanelSection>
    );
  }
  const decision = checkEditorCapability(props.document, props.mode, {
    capability: "layout.edit",
    target: { kind: "node", nodeId: element.id },
  });
  const styleDisabled = !decision.allowed;
  const styleReason = decision.allowed ? undefined : decision.reason;
  const textColorId = `inspector-${element.id}-style-color`;
  const backgroundColorId = `inspector-${element.id}-style-background`;
  const liveTextColor = currentBufferedValue(props, textColorId, element.style?.color ?? "#1f2937");
  const liveBackgroundColor = currentBufferedValue(props, backgroundColorId, element.style?.background ?? "transparent");
  const liveContrast = contrastRatio(
    liveTextColor,
    liveBackgroundColor,
    props.document.page.background ?? "#ffffff",
  );
  const entries = [
    { property: "color" as const, label: "Text color", fallback: "#1f2937" },
    { property: "background" as const, label: "Background color", fallback: "transparent" },
    { property: "borderColor" as const, label: "Border color", fallback: "#1f2937" },
  ];
  return (
    <>
      <PanelSection title="Colors">
        {entries.map(({ property, label, fallback }) => {
          const id = `inspector-${element.id}-style-${property}`;
          return (
            <BufferedControl
              key={property}
              controlId={id}
              label={label}
              canonicalValue={element.style?.[property] ?? fallback}
              baseDocumentRevision={props.documentRevision}
              {...bufferedRestoration(props, id)}
              onBuffer={props.onEditBufferChange}
              disabled={styleDisabled}
              disabledReason={styleReason}
              onCommit={(value) => {
                try {
                  return commandResult(props.store, createSetElementStyleCommand({
                    nodeId: element.id,
                    style: { ...element.style, [property]: normalizedColor(value) },
                  }));
                } catch (error) {
                  return error instanceof Error ? error.message : "Enter a valid color.";
                }
              }}
            />
          );
        })}
        <p
          className={`cbb-contrast-check${liveContrast !== undefined && liveContrast < 4.5 ? " is-warning" : ""}`}
          role="status"
        >
          {liveContrast === undefined
            ? "Contrast preview will appear when the text and background colors are valid."
            : liveContrast < 4.5
              ? `Needs attention: text contrast is ${liveContrast.toFixed(2)}:1. Aim for at least 4.5:1 for ordinary text.`
              : `Text contrast is ${liveContrast.toFixed(2)}:1 and meets the 4.5:1 ordinary-text target.`}
        </p>
      </PanelSection>
      <PanelSection title="Typography">
        <BufferedControl
          controlId={`inspector-${element.id}-font-size`}
          label="Font size"
          canonicalValue={String(element.style?.fontSize ?? "12pt")}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, `inspector-${element.id}-font-size`)}
          onBuffer={props.onEditBufferChange}
          disabled={styleDisabled}
          disabledReason={styleReason}
          onCommit={(value) => {
            try {
              return commandResult(props.store, createSetElementStyleCommand({
                nodeId: element.id,
                style: { ...element.style, fontSize: normalizedLength(value) },
              }));
            } catch (error) {
              return error instanceof Error ? error.message : "Enter a physical font size.";
            }
          }}
        />
        <div className="cbb-inspector-field">
          <label htmlFor={`inspector-${element.id}-align`}>Alignment</label>
          <select
            id={`inspector-${element.id}-align`}
            value={element.style?.align ?? "left"}
            disabled={styleDisabled}
            title={styleReason}
            onChange={(event) => commandResult(props.store, createSetElementStyleCommand({
              nodeId: element.id,
              style: { ...element.style, align: event.currentTarget.value as "left" | "center" | "right" | "justify" },
            }))}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justified</option>
          </select>
        </div>
        <div className="cbb-inspector-field">
          <label htmlFor={`inspector-${element.id}-weight`}>Weight</label>
          <select
            id={`inspector-${element.id}-weight`}
            value={element.style?.fontWeight ?? "regular"}
            disabled={styleDisabled}
            title={styleReason}
            onChange={(event) => commandResult(props.store, createSetElementStyleCommand({
              nodeId: element.id,
              style: { ...element.style, fontWeight: event.currentTarget.value as "regular" | "medium" | "semibold" | "bold" },
            }))}
          >
            <option value="regular">Regular</option>
            <option value="medium">Medium</option>
            <option value="semibold">Semibold</option>
            <option value="bold">Bold</option>
          </select>
        </div>
        <div className="cbb-inspector-field">
          <label htmlFor={`inspector-${element.id}-font-style`}>Style</label>
          <select
            id={`inspector-${element.id}-font-style`}
            value={element.style?.fontStyle ?? "normal"}
            disabled={styleDisabled}
            title={styleReason}
            onChange={(event) => commandResult(props.store, createSetElementStyleCommand({
              nodeId: element.id,
              style: { ...element.style, fontStyle: event.currentTarget.value as "normal" | "italic" },
            }))}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </div>
        <div className="cbb-inspector-field">
          <label htmlFor={`inspector-${element.id}-vertical-align`}>Vertical alignment</label>
          <select
            id={`inspector-${element.id}-vertical-align`}
            value={element.style?.verticalAlign ?? "top"}
            disabled={styleDisabled}
            title={styleReason}
            onChange={(event) => commandResult(props.store, createSetElementStyleCommand({
              nodeId: element.id,
              style: { ...element.style, verticalAlign: event.currentTarget.value as "top" | "center" | "bottom" },
            }))}
          >
            <option value="top">Top</option>
            <option value="center">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
      </PanelSection>
      <PanelSection title="Border">
        <BufferedControl
          controlId={`inspector-${element.id}-border-width`}
          label="Border width"
          canonicalValue={String(element.style?.borderWidth ?? "0pt")}
          baseDocumentRevision={props.documentRevision}
          {...bufferedRestoration(props, `inspector-${element.id}-border-width`)}
          onBuffer={props.onEditBufferChange}
          disabled={styleDisabled}
          disabledReason={styleReason}
          onCommit={(value) => {
            try {
              return commandResult(props.store, createSetElementStyleCommand({
                nodeId: element.id,
                style: { ...element.style, borderWidth: normalizedLength(value) },
              }));
            } catch (error) {
              return error instanceof Error ? error.message : "Enter a physical border width.";
            }
          }}
        />
      </PanelSection>
    </>
  );
}

function AccessibilityPanel(props: InspectorPanelProps & {
  readonly element?: NativeElement | undefined;
  readonly policyNodeId?: NodeId | undefined;
  readonly ownPolicy?: NativeElement["authoringPolicy"] | undefined;
}) {
  const { element } = props;
  const previewElement = element === undefined
    ? undefined
    : uniqueResolvedElement(props.document, element.id);
  const previewImage = element?.type === "image" && previewElement?.type === "image"
    ? previewElement
    : element?.type === "image" ? element : undefined;
  const policyNodeId = props.policyNodeId ?? element?.id;
  const imageAccessibilityDecision = element?.type === "image"
    ? checkEditorCapability(props.document, props.mode, {
        capability: "content.editAccessibility",
        target: { kind: "node", nodeId: element.id },
      })
    : undefined;
  const policy = effectiveAuthoringPolicy(props.document, policyNodeId === undefined
    ? { kind: "document" }
    : { kind: "node", nodeId: policyNodeId });
  const ownPolicy = props.ownPolicy ?? element?.authoringPolicy ?? props.document.authoringPolicy;
  const policyDisabled = props.mode !== "customizeLayout";
  const headingFindings = element === undefined ? headingOrderFindings(props.document) : [];
  return (
    <>
      {element?.type === "image"
        ? (
          <PanelSection title="Image description">
            <div className="cbb-inspector-field cbb-checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={previewImage?.data.decorative === true}
                  disabled={imageAccessibilityDecision?.allowed === false}
                  title={imageAccessibilityDecision?.allowed === false ? imageAccessibilityDecision.reason : undefined}
                  onChange={(event) => commandResult(props.store, createSetImageAccessibilityCommand({
                    nodeId: element.id,
                    decorative: event.currentTarget.checked,
                    ...(previewImage?.data.alt === undefined ? {} : { alt: previewImage.data.alt }),
                  }))}
                />
                This image is only decorative
              </label>
            </div>
            <BufferedControl
              controlId={`inspector-${element.id}-alt`}
              label="Description for people who cannot see the image"
              canonicalValue={previewImage?.data.alt ?? ""}
              baseDocumentRevision={props.documentRevision}
              {...bufferedRestoration(props, `inspector-${element.id}-alt`)}
              onBuffer={props.onEditBufferChange}
              multiline
              disabled={previewImage?.data.decorative === true || imageAccessibilityDecision?.allowed === false}
              disabledReason={imageAccessibilityDecision?.allowed === false
                ? imageAccessibilityDecision.reason
                : "Decorative images are skipped by assistive reading order."}
              description="Describe the important information or purpose, not every visual detail."
              onCommit={(value) => commandResult(props.store, createSetImageAccessibilityCommand({
                nodeId: element.id,
                alt: value,
                decorative: false,
              }))}
            />
          </PanelSection>
        )
        : (
          <PanelSection title="Accessible document help">
            <p>{element === undefined
              ? "Review heading order, image descriptions, table headers, and reading order while you edit."
              : `The selected ${contentKindName(element).toLowerCase()} remains in the document reading order.`}</p>
            {element === undefined
              ? (
                <div className={`cbb-heading-check${headingFindings.length > 0 ? " is-warning" : ""}`} role="note" aria-label="Heading order check">
                  <strong>{headingFindings.length === 0 ? "Heading order looks consistent." : "Heading order needs attention."}</strong>
                  {headingFindings.length === 0
                    ? null
                    : <ul>{headingFindings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
                </div>
              )
              : null}
          </PanelSection>
        )}
      <details className="cbb-inspector-advanced">
        <summary>Advanced editing protection</summary>
        <p>Protection inherited from a parent is shown here. Set this item’s own protection below.</p>
        <p className="cbb-policy-summary">Effective: content {policy?.contentLocked === true ? "protected" : "editable"}; layout {policy?.layoutLocked === true ? "protected" : "editable"}.</p>
        <label className="cbb-check-row">
          <input
            type="checkbox"
            checked={ownPolicy?.contentLocked ?? false}
            disabled={policyDisabled}
            onChange={(event) => commandResult(props.store, createSetAuthoringPolicyCommand({
              ...(policyNodeId === undefined ? {} : { nodeId: policyNodeId }),
              contentLocked: event.currentTarget.checked,
              ...(ownPolicy?.layoutLocked === undefined ? {} : { layoutLocked: ownPolicy.layoutLocked }),
            }))}
          />
          Protect content in Weekly Content
        </label>
        <label className="cbb-check-row">
          <input
            type="checkbox"
            checked={ownPolicy?.layoutLocked ?? false}
            disabled={policyDisabled}
            onChange={(event) => commandResult(props.store, createSetAuthoringPolicyCommand({
              ...(policyNodeId === undefined ? {} : { nodeId: policyNodeId }),
              ...(ownPolicy?.contentLocked === undefined ? {} : { contentLocked: ownPolicy.contentLocked }),
              layoutLocked: event.currentTarget.checked,
            }))}
          />
          Protect layout
        </label>
        {policyDisabled ? <p className="cbb-field-help">Switch to Customize Layout to change protection.</p> : null}
      </details>
    </>
  );
}

export function InspectorPanel(props: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>(props.mode === "weeklyContent" ? "content" : "layout");
  const tabRefs = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({});
  const [localEditBuffers, setLocalEditBuffers] = useState<Readonly<Record<string, InspectorRestoredEditBuffer | null>>>({});
  useEffect(() => {
    if (props.mode === "weeklyContent") setTab("content");
  }, [props.mode]);
  const handleEditBufferChange = useCallback((update: InspectorEditBufferUpdate): void => {
    setLocalEditBuffers((current) => {
      const next = { ...current };
      if (update.status === "committed" || update.status === "discarded") {
        next[update.controlId] = null;
      } else {
        next[update.controlId] = {
          value: update.value,
          baseDocumentRevision: update.baseDocumentRevision,
          baseResourceRevisionToken: update.baseResourceRevisionToken,
          baseCanonicalHash: update.baseCanonicalHash,
          status: update.status,
          ...(update.error === undefined ? {} : { error: update.error }),
        };
      }
      return next;
    });
    props.onEditBufferChange?.(update);
  }, [props.onEditBufferChange]);
  const restoredEditBuffers: Record<string, string | InspectorRestoredEditBuffer> = {
    ...props.restoredEditBuffers,
  };
  for (const [controlId, buffer] of Object.entries(localEditBuffers)) {
    if (buffer === null) delete restoredEditBuffers[controlId];
    else restoredEditBuffers[controlId] = buffer;
  }
  const panelProps: InspectorPanelProps = {
    ...props,
    restoredEditBuffers,
    onEditBufferChange: handleEditBufferChange,
  };
  const location = props.selectedNodeId === undefined
    ? undefined
    : findElementLocation(props.document, props.selectedNodeId);
  const placement = props.selectedNodeId === undefined || location !== undefined
    ? undefined
    : findPlacementWrapperLocation(props.document, props.selectedNodeId);
  const element = location?.element ?? placement?.wrapper.element;
  const placementSelected = placement !== undefined;
  const title = element === undefined
    ? "Page setup"
    : placementSelected ? `${element.name} placement` : element.name;
  const selectionKey = props.selectedNodeId ?? "document";
  const tabs: readonly { readonly id: InspectorTab; readonly label: string }[] = [
    { id: "content", label: "Content" },
    { id: "layout", label: "Layout" },
    { id: "appearance", label: "Appearance" },
    { id: "accessibility", label: "Accessibility" },
  ];

  return (
    <aside className="cbb-inspector-panel" aria-label="Inspector">
      <header>
        <p>Inspector</p>
        <h2>{title}</h2>
        <span>{element === undefined
          ? "Finished page and document settings"
          : placementSelected ? `${placement.kind} placement settings` : contentKindName(element)}</span>
      </header>
      <div role="tablist" aria-label="Inspector sections" className="cbb-inspector-tabs">
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            id={`inspector-tab-${candidate.id}`}
            type="button"
            role="tab"
            ref={(node) => { tabRefs.current[candidate.id] = node; }}
            aria-selected={tab === candidate.id}
            aria-controls={`inspector-panel-${candidate.id}`}
            tabIndex={tab === candidate.id ? 0 : -1}
            onClick={() => setTab(candidate.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((entry) => entry.id === candidate.id);
              const next = event.key === "Home"
                ? tabs[0]
                : event.key === "End"
                  ? tabs.at(-1)
                  : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
              if (next !== undefined) {
                setTab(next.id);
                tabRefs.current[next.id]?.focus();
              }
            }}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div className="cbb-inspector-scroll">
        <div id="inspector-panel-content" role="tabpanel" aria-labelledby="inspector-tab-content" hidden={tab !== "content"}>
          {placementSelected
            ? <><PanelSection title="Placement"><p>This selection owns position, size, and layout protection. The wrapped item’s content controls remain available below.</p></PanelSection><ContentPanel key={selectionKey} {...panelProps} element={element} /></>
            : <ContentPanel key={selectionKey} {...panelProps} element={element} />}
        </div>
        <div id="inspector-panel-layout" role="tabpanel" aria-labelledby="inspector-tab-layout" hidden={tab !== "layout"}>
          {element === undefined
            ? <PageLayoutPanel key={selectionKey} {...panelProps} />
            : <ElementLayoutPanel key={selectionKey} {...panelProps} element={element} />}
        </div>
        <div id="inspector-panel-appearance" role="tabpanel" aria-labelledby="inspector-tab-appearance" hidden={tab !== "appearance"}>
          {placementSelected
            ? <><PanelSection title="Placement appearance"><p>Visual styling belongs to the item inside this placement.</p></PanelSection><AppearancePanel key={selectionKey} {...panelProps} element={element} /></>
            : <AppearancePanel key={selectionKey} {...panelProps} element={element} />}
        </div>
        <div id="inspector-panel-accessibility" role="tabpanel" aria-labelledby="inspector-tab-accessibility" hidden={tab !== "accessibility"}>
          <AccessibilityPanel
            key={selectionKey}
            {...panelProps}
            element={element}
            {...(placement === undefined
              ? {}
              : { policyNodeId: placement.wrapper.id, ownPolicy: placement.wrapper.authoringPolicy })}
          />
        </div>
      </div>
    </aside>
  );
}
