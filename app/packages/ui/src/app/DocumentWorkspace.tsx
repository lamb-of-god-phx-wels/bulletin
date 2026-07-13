import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  canonicalRevisionToken,
  type CbbDocument,
  type IdPort,
  type NativeElement,
  type NodeId,
} from "@cbb/core";
import { Button, LiveRegion } from "../design-system/index.js";
import {
  canonicalSpellingDictionary,
  canonicalSpellingWord,
  EditorWorkspace,
  MAX_CHURCH_DICTIONARY_WORDS,
  persistedLengthToEditorPixels,
} from "../editor/index.js";
import type { EditorWorkspaceViewState } from "../editor/index.js";
import { createEditorRenderModel } from "../editor/renderModel.js";
import type {
  RendererBridge,
  RendererImageAssetSummary,
  RendererLoadedDocument,
  RendererResourceKind,
} from "../bridge/index.js";
import type { InspectorRestoredEditBuffer } from "../inspector/index.js";
import { FirstBulletinTour } from "../onboarding/index.js";
import type { UiSettings } from "../settings/index.js";
import {
  assertEditorDocumentValid,
  createApplyTemplateAuthoringChangesCommand,
  createReplaceImageCommand,
  EditorStore,
  findElementLocation,
  type CompleteFocalPoint,
} from "../store/index.js";
import {
  createTemplateFromDocument,
  templateValueReviewItems,
  type TemplateValueDecisions,
} from "./documentFactory.js";
import { InspectorBufferPersistence } from "./editBufferPersistence.js";
import { ImageAssetChooser } from "./ImageAssetChooser.js";
import { ImageReplacementReview } from "./ImageReplacementReview.js";
import { ImageAssetObjectUrlStore } from "./imageAssetObjectUrls.js";
import { PreviewPane } from "./PreviewPane.js";
import { SourceTemplateUpdateReview } from "./SourceTemplateUpdateReview.js";
import { TemplateValueReview } from "./TemplateValueReview.js";
import { WeeklyWorkflowSandbox } from "./WeeklyWorkflowSandbox.js";
import {
  SerializedDocumentAutosave,
  type AutosaveState,
} from "./serializedAutosave.js";

export interface DocumentWorkspaceProps {
  readonly bridge: RendererBridge;
  readonly workspaceAccess: "readWrite" | "readOnly";
  readonly loaded: RendererLoadedDocument;
  readonly settings: UiSettings;
  readonly idPort: IdPort;
  readonly onBack: () => void;
  readonly onCreateResource: (
    document: CbbDocument,
    resourceKind: RendererResourceKind,
  ) => Promise<RendererLoadedDocument | undefined>;
  readonly onViewSettingsChange: (settings: UiSettings) => void;
  /** Workspace-local only; never copied into loaded.document. */
  readonly sourceTemplateLocalResourceId?: string;
  readonly onOpenSourceTemplate?: () => Promise<void>;
  readonly onChangeOnlyThisBulletin?: () => Promise<void>;
  readonly showFirstBulletinTour?: boolean;
  readonly onFirstBulletinTourFinished?: () => void;
  readonly confirmAction?: (message: string) => boolean;
}

type PendingTemplateValueReview =
  | { readonly kind: "create"; readonly bulletin: CbbDocument }
  | {
      readonly kind: "sourceUpdate";
      readonly bulletin: CbbDocument;
      readonly source: RendererLoadedDocument;
    };

interface PendingSourceTemplateUpdate {
  readonly source: RendererLoadedDocument;
  readonly candidate: CbbDocument;
  readonly sourceChangedSinceBulletinCreation: boolean;
  readonly busy: boolean;
  readonly error?: string;
}

interface PendingImageReplacement {
  readonly nodeId: NodeId;
  readonly assetRef: string;
  readonly source: string;
  readonly displayName: string;
  readonly fit: "contain" | "cover";
  readonly currentFocalPoint: CompleteFocalPoint;
  readonly alt?: string | undefined;
  readonly decorative: boolean;
  readonly destinationAspectRatio?: number | undefined;
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

const CLEAN_STATE: AutosaveState = {
  status: "clean",
  message: "All changes saved",
};

function defaultConfirm(message: string): boolean {
  return window.confirm(message);
}

function collectAssetRefs(value: unknown): ReadonlySet<string> {
  const refs = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate === "string") {
      if (candidate.startsWith("asset:")) refs.add(candidate);
      continue;
    }
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
    } else {
      pending.push(...Object.values(candidate));
    }
  }
  return refs;
}

function sourceTemplateCandidate(
  bulletin: CbbDocument,
  source: CbbDocument,
  decisions: TemplateValueDecisions,
): CbbDocument {
  const converted = createTemplateFromDocument(bulletin, source.name, decisions);
  const validFieldIds = new Set((converted.fieldContract?.fields ?? []).map((field) => field.id));
  const reviewedFieldIds = new Set(
    templateValueReviewItems(bulletin).flatMap((item) =>
      item.target.scope === "document" ? [item.fieldId] : []),
  );
  const sourceSamples = Object.fromEntries(Object.entries(source.sampleFieldValues ?? {})
    .filter(([fieldId]) => validFieldIds.has(fieldId) && !reviewedFieldIds.has(fieldId)));
  const sampleFieldValues = {
    ...sourceSamples,
    ...(converted.sampleFieldValues ?? {}),
  };
  return {
    ...converted,
    ...(Object.keys(sampleFieldValues).length === 0 ? {} : { sampleFieldValues }),
  };
}

export function DocumentWorkspace({
  bridge,
  workspaceAccess,
  loaded,
  settings,
  idPort,
  onBack,
  onCreateResource,
  onViewSettingsChange,
  sourceTemplateLocalResourceId,
  onOpenSourceTemplate,
  onChangeOnlyThisBulletin,
  showFirstBulletinTour = false,
  onFirstBulletinTourFinished,
  confirmAction = defaultConfirm,
}: DocumentWorkspaceProps) {
  const readOnly = workspaceAccess === "readOnly";
  const store = useMemo(
    () => new EditorStore(loaded.document, {
      readOnly,
      validateDocument: assertEditorDocumentValid,
    }),
    [loaded, readOnly],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [durableRevisionToken, setDurableRevisionToken] = useState<string | null>(loaded.revisionToken);
  const bufferPersistence = useMemo(
    () => new InspectorBufferPersistence(bridge, loaded.localResourceId, loaded.revisionToken),
    [bridge, loaded.localResourceId, loaded.revisionToken],
  );
  const [restoredBuffers, setRestoredBuffers] = useState<
    Readonly<Record<string, InspectorRestoredEditBuffer>> | undefined
  >(readOnly ? {} : undefined);
  const [bufferWarning, setBufferWarning] = useState<string>();
  const [saveState, setSaveState] = useState<AutosaveState>(readOnly
    ? { status: "clean", message: "Read-only — editing is disabled" }
    : CLEAN_STATE);
  const [actionMessage, setActionMessage] = useState("");
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string>();
  const [imageAssets, setImageAssets] = useState<readonly RendererImageAssetSummary[]>([]);
  const imageAssetsRef = useRef<readonly RendererImageAssetSummary[]>([]);
  const [imageLibraryBusy, setImageLibraryBusy] = useState(true);
  const [imageImportBusy, setImageImportBusy] = useState(false);
  const [imageLibraryError, setImageLibraryError] = useState<string>();
  const [imageChooserOpen, setImageChooserOpen] = useState(false);
  const [pendingImageReplacement, setPendingImageReplacement] = useState<PendingImageReplacement>();
  const [templateValueReview, setTemplateValueReview] = useState<PendingTemplateValueReview>();
  const [sourceTemplateUpdate, setSourceTemplateUpdate] = useState<PendingSourceTemplateUpdate>();
  const [weeklyWorkflowTest, setWeeklyWorkflowTest] = useState<CbbDocument>();
  const [spellingDictionary, setSpellingDictionary] = useState<readonly string[]>([]);
  const [, setImageUrlRevision] = useState(0);
  const imageUrls = useMemo(
    () => new ImageAssetObjectUrlStore(),
    [bridge, loaded.localResourceId],
  );
  const imageChoiceResolver = useRef<((assetRef: string | undefined) => void) | undefined>(undefined);
  const saver = useRef<SerializedDocumentAutosave | undefined>(undefined);
  const documentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void bridge.readChurchProfile().then((snapshot) => {
      if (active) setSpellingDictionary(canonicalSpellingDictionary(snapshot.value?.spellingDictionary ?? []));
    }).catch(() => {
      if (active) setSpellingDictionary([]);
    });
    return () => { active = false; };
  }, [bridge, loaded.localResourceId]);

  useEffect(() => {
    setDurableRevisionToken(loaded.revisionToken);
  }, [loaded.localResourceId, loaded.revisionToken]);

  useEffect(() => {
    if (restoredBuffers !== undefined) documentHeadingRef.current?.focus();
  }, [loaded.localResourceId, restoredBuffers]);

  useEffect(() => () => {
    imageChoiceResolver.current?.(undefined);
    imageChoiceResolver.current = undefined;
    imageUrls.dispose();
  }, [imageUrls]);

  useEffect(() => {
    let active = true;
    imageAssetsRef.current = [];
    setImageAssets([]);
    setImageLibraryBusy(true);
    setImageLibraryError(undefined);
    void (async () => {
      try {
        const assets = await bridge.listImageAssets();
        if (!active) return;
        imageAssetsRef.current = assets;
        setImageAssets(assets);
        const referenced = collectAssetRefs(loaded.document);
        let previewFailure = false;
        for (const asset of assets) {
          if (!active || !referenced.has(asset.assetRef)) continue;
          try {
            await imageUrls.ensure(asset, (localAssetId, assetRef) =>
              bridge.readImageAssetBytes(localAssetId, assetRef)
            );
            if (active) setImageUrlRevision((revision) => revision + 1);
          } catch {
            previewFailure = true;
          }
        }
        if (active && previewFailure) {
          setImageLibraryError("One or more installed image previews could not be opened safely.");
        }
      } catch (error) {
        if (!active) return;
        setImageLibraryError(error instanceof Error
          ? error.message
          : "The validated image library could not be opened.");
      } finally {
        if (active) setImageLibraryBusy(false);
      }
    })();
    return () => { active = false; };
  }, [bridge, imageUrls, loaded.document]);

  useEffect(() => {
    let active = true;
    if (readOnly) {
      setRestoredBuffers({});
      setBufferWarning(undefined);
      return () => { active = false; };
    }
    setRestoredBuffers(undefined);
    setBufferWarning(undefined);
    void bufferPersistence.restore().then((result) => {
      if (!active) return;
      setRestoredBuffers(result.buffers);
      setBufferWarning(result.warning);
    }).catch((error: unknown) => {
      if (!active) return;
      setRestoredBuffers({});
      setBufferWarning(error instanceof Error
        ? error.message
        : "Unfinished inspector text could not be restored.");
    });
    return () => { active = false; };
  }, [bufferPersistence, readOnly]);

  useEffect(() => {
    if (readOnly) {
      saver.current = undefined;
      setSaveState({ status: "clean", message: "Read-only — editing is disabled" });
      return;
    }
    const autosave = new SerializedDocumentAutosave({
      bridge,
      localResourceId: loaded.localResourceId,
      resourceKind: loaded.resourceKind,
      baseRevisionToken: loaded.revisionToken,
      onStateChange: (state) => {
        setSaveState(state);
        if (state.status === "clean") setLeaveError(undefined);
      },
      onSaved: (_document, revisionToken) => {
        setDurableRevisionToken(revisionToken);
        setPreviewRefresh((value) => value + 1);
      },
    });
    saver.current = autosave;
    const unsubscribe = store.subscribeToDocumentChanges((event) => {
      void autosave.enqueue(event.document);
    });
    return () => {
      unsubscribe();
      autosave.dispose();
      if (saver.current === autosave) saver.current = undefined;
    };
  }, [bridge, loaded, readOnly, store]);

  const selectedSourceElementId = snapshot.selection.kind === "node"
    ? snapshot.selection.nodeId
    : snapshot.selection.kind === "field"
      ? snapshot.selection.ownerNodeId
      : undefined;
  const previewZoom = settings.previewZoom;
  const snapSizePx = persistedLengthToEditorPixels(settings.canvasSnapGridSize, 8);
  const imageLibraryUnavailableReason = readOnly
    ? "This bulletin library is open read-only."
    : imageLibraryBusy
      ? "The validated image library is still opening."
      : undefined;

  function requestImageAssetChoice(): Promise<string | undefined> {
    if (imageLibraryUnavailableReason !== undefined) {
      setActionMessage(imageLibraryUnavailableReason);
      return Promise.resolve(undefined);
    }
    if (imageChoiceResolver.current !== undefined) {
      return Promise.resolve(undefined);
    }
    setImageChooserOpen(true);
    return new Promise((resolve) => {
      imageChoiceResolver.current = resolve;
    });
  }

  function finishImageAssetChoice(assetRef: string | undefined): void {
    const resolve = imageChoiceResolver.current;
    imageChoiceResolver.current = undefined;
    setImageChooserOpen(false);
    resolve?.(assetRef);
  }

  async function importImageIntoChooser(): Promise<void> {
    if (imageImportBusy) return;
    setImageImportBusy(true);
    setImageLibraryError(undefined);
    try {
      const outcome = await bridge.importImageAsset();
      if (outcome.status === "canceled") return;
      if (outcome.status !== "imported") {
        setImageLibraryError(outcome.message);
        return;
      }
      const refreshed = await bridge.listImageAssets();
      const installed = refreshed.find((asset) =>
        asset.localAssetId === outcome.asset.localAssetId &&
        asset.assetRef === outcome.asset.assetRef
      );
      if (installed === undefined) {
        throw new Error("The imported image was installed but could not be reopened safely.");
      }
      await imageUrls.ensure(installed, (localAssetId, assetRef) =>
        bridge.readImageAssetBytes(localAssetId, assetRef)
      );
      imageAssetsRef.current = refreshed;
      setImageAssets(refreshed);
      setImageUrlRevision((revision) => revision + 1);
      finishImageAssetChoice(installed.assetRef);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "That image could not be imported safely.";
      setImageLibraryError(message);
      setActionMessage(message);
    } finally {
      setImageImportBusy(false);
    }
  }

  async function chooseReadyImageAsset(): Promise<string | undefined> {
    const assetRef = await requestImageAssetChoice();
    if (assetRef === undefined) return undefined;
    const asset = imageAssetsRef.current.find((candidate) => candidate.assetRef === assetRef);
    if (asset === undefined) {
      setActionMessage("That installed image is no longer available.");
      return undefined;
    }
    try {
      await imageUrls.ensure(asset, (localAssetId, ref) =>
        bridge.readImageAssetBytes(localAssetId, ref)
      );
      setImageUrlRevision((revision) => revision + 1);
      return assetRef;
    } catch (error) {
      setActionMessage(error instanceof Error
        ? error.message
        : "That image could not be opened safely.");
      return undefined;
    }
  }

  async function replaceImage(nodeId: NodeId): Promise<void> {
    const assetRef = await chooseReadyImageAsset();
    if (assetRef === undefined) return;
    const asset = imageAssetsRef.current.find((candidate) => candidate.assetRef === assetRef);
    const source = imageUrls.url(assetRef);
    const document = store.getSnapshot().document;
    const location = findElementLocation(document, nodeId);
    if (asset === undefined || source === undefined || location?.element.type !== "image") {
      setActionMessage("That replacement image could not be reviewed safely.");
      return;
    }
    const renderModel = createEditorRenderModel(document);
    const previewOccurrences = [
      ...renderModel.elements.map((entry) => entry.element),
      ...renderModel.pageElements.map((entry) => entry.wrapper.element),
    ].map((root) => nestedElement(root, nodeId)).filter(
      (element): element is NativeElement => element !== undefined,
    );
    const previewElement = previewOccurrences.length === 1
      ? previewOccurrences[0] ?? location.element
      : location.element;
    const rect = window.document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] .cbb-element-frame`)
      ?.getBoundingClientRect();
    const measuredAspect = rect !== undefined && rect.width > 0 && rect.height > 0
      ? rect.width / rect.height
      : undefined;
    const widthValue = location.parent.kind === "page"
      ? location.parent.wrapper.width
      : location.element.width;
    const heightValue = location.parent.kind === "page"
      ? location.parent.wrapper.height
      : location.element.height;
    const fallbackWidth = persistedLengthToEditorPixels(widthValue, 0);
    const fallbackHeight = persistedLengthToEditorPixels(heightValue, 0);
    setPendingImageReplacement({
      nodeId,
      assetRef,
      source,
      displayName: asset.displayName,
      fit: previewElement.type === "image" ? previewElement.data.fit : location.element.data.fit,
      currentFocalPoint: {
        x: (previewElement.type === "image"
          ? previewElement.data.focalPoint?.x
          : location.element.data.focalPoint?.x) ?? 0.5,
        y: (previewElement.type === "image"
          ? previewElement.data.focalPoint?.y
          : location.element.data.focalPoint?.y) ?? 0.5,
      },
      ...(previewElement.type !== "image" || previewElement.data.alt === undefined
        ? {}
        : { alt: previewElement.data.alt }),
      decorative: previewElement.type === "image"
        ? previewElement.data.decorative === true
        : location.element.data.decorative === true,
      ...(measuredAspect !== undefined
        ? { destinationAspectRatio: measuredAspect }
        : fallbackWidth > 0 && fallbackHeight > 0
          ? { destinationAspectRatio: fallbackWidth / fallbackHeight }
          : {}),
    });
  }

  function confirmImageReplacement(focalPoint: CompleteFocalPoint): void {
    const pending = pendingImageReplacement;
    if (pending === undefined) return;
    try {
      const result = store.execute(createReplaceImageCommand({
        nodeId: pending.nodeId,
        assetRef: pending.assetRef,
        focalPoint,
      }));
      setPendingImageReplacement(undefined);
      setActionMessage(result.status === "denied"
        ? result.denial.reason
        : result.status === "noChange"
          ? "That image is already selected."
          : pending.decorative
            ? "Image replaced. Confirm that marking it decorative is still accurate."
            : "Image replaced. Review its description for accuracy.");
    } catch (error) {
      setActionMessage(error instanceof Error
        ? error.message
        : "That image could not be replaced safely.");
    }
  }

  async function addSpellingDictionaryWord(rawWord: string): Promise<string> {
    const word = canonicalSpellingWord(rawWord);
    if (word === undefined) throw new Error("Select one word of at most 64 letters.");
    if (readOnly) throw new Error("The Church Profile cannot be changed while this library is read-only.");
    let profile = await bridge.readChurchProfile();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = canonicalSpellingDictionary(profile.value?.spellingDictionary ?? []);
      if (current.includes(word)) {
        setSpellingDictionary(current);
        return `“${word}” is already in the Church Profile dictionary.`;
      }
      if (current.length >= MAX_CHURCH_DICTIONARY_WORDS) {
        throw new Error(`The Church Profile dictionary is full (${MAX_CHURCH_DICTIONARY_WORDS} words).`);
      }
      const next = canonicalSpellingDictionary([...current, word]);
      const outcome = await bridge.writeChurchProfile({
        ...(profile.value ?? { version: 1 as const, kind: "churchProfile" as const }),
        spellingDictionary: next,
      }, profile.revisionToken);
      if (outcome.status === "saved") {
        setSpellingDictionary(canonicalSpellingDictionary(outcome.value.spellingDictionary ?? []));
        return `Added “${word}” to the Church Profile dictionary on this computer.`;
      }
      if (outcome.status !== "conflicted") throw new Error(outcome.message);
      profile = await bridge.readChurchProfile();
    }
    throw new Error("The Church Profile changed repeatedly. Try adding the word again.");
  }

  function imageAssetInfo(assetRef: string) {
    const asset = imageAssets.find((candidate) => candidate.assetRef === assetRef);
    if (asset === undefined) return undefined;
    return {
      displayName: asset.displayName,
      kind: asset.mediaType === "image/svg+xml" ? "vector" as const : "raster" as const,
      ...(asset.pixelWidth === undefined ? {} : { pixelWidth: asset.pixelWidth }),
      ...(asset.pixelHeight === undefined ? {} : { pixelHeight: asset.pixelHeight }),
    };
  }

  function leaveEditor(): void {
    setLeaving(true);
    setLeaveError(undefined);
    void Promise.all([
      saver.current?.flush() ?? Promise.resolve(),
      readOnly ? Promise.resolve() : bufferPersistence.flush(),
    ]).then(onBack).catch((error: unknown) => {
      setLeaving(false);
      const detail = error instanceof Error
        ? error.message
        : "Local recovery text is still being protected.";
      const message = `Your changes are still open here. ${detail}`;
      setLeaveError(message);
      setActionMessage(message);
    });
  }

  async function flushProtectedChanges(): Promise<void> {
    await Promise.all([
      saver.current?.flush() ?? Promise.resolve(),
      readOnly ? Promise.resolve() : bufferPersistence.flush(),
    ]);
  }

  async function openSourceTemplate(): Promise<void> {
    if (sourceTemplateLocalResourceId === undefined || onOpenSourceTemplate === undefined) return;
    setActionMessage("Opening the source template…");
    try {
      await flushProtectedChanges();
      await onOpenSourceTemplate();
    } catch (error) {
      setActionMessage(error instanceof Error
        ? error.message
        : "The source template could not be opened. This bulletin is still safe and independent.");
    }
  }

  async function changeOnlyThisBulletin(): Promise<void> {
    if (sourceTemplateLocalResourceId === undefined || onChangeOnlyThisBulletin === undefined) return;
    if (!confirmAction(
      "Remove the source-template shortcut? This bulletin stays unchanged and independent. The template also stays unchanged.",
    )) return;
    setActionMessage("Removing the source-template shortcut…");
    try {
      await onChangeOnlyThisBulletin();
      setActionMessage("Changes will stay only in this bulletin. The source template was not changed.");
    } catch (error) {
      setActionMessage(error instanceof Error
        ? error.message
        : "The source-template shortcut could not be removed. No document was changed.");
    }
  }

  async function beginSourceTemplateUpdate(bulletin: CbbDocument): Promise<void> {
    if (sourceTemplateLocalResourceId === undefined) return;
    setActionMessage("Opening the source template for review…");
    try {
      await flushProtectedChanges();
      const source = await bridge.loadDocument(sourceTemplateLocalResourceId);
      if (source.resourceKind !== "template" || source.document.kind !== "template") {
        throw new Error(
          "The saved source reference no longer points to a template. This bulletin is still safe and independent.",
        );
      }
      setTemplateValueReview({ kind: "sourceUpdate", bulletin, source });
      setActionMessage("");
    } catch (error) {
      setActionMessage(error instanceof Error
        ? error.message
        : "The source template could not be reviewed. This bulletin and template were not changed.");
    }
  }

  async function confirmSourceTemplateUpdate(): Promise<void> {
    const pending = sourceTemplateUpdate;
    if (pending === undefined || pending.busy) return;
    const { error: _previousError, ...withoutError } = pending;
    setSourceTemplateUpdate({ ...withoutError, busy: true });
    try {
      const outcome = await bridge.saveDocument({
        localResourceId: pending.source.localResourceId,
        resourceKind: "template",
        displayName: pending.candidate.name,
        document: pending.candidate,
        baseRevisionToken: pending.source.revisionToken,
      });
      if (outcome.status !== "saved") {
        const prefix = outcome.status === "conflicted"
          ? "The source template changed while you were reviewing it, so it was not overwritten. Close this review and start again."
          : "The source template was not updated.";
        setSourceTemplateUpdate({
          ...pending,
          busy: false,
          error: `${prefix} ${outcome.message}`,
        });
        return;
      }
      setSourceTemplateUpdate(undefined);
      setActionMessage(
        "The source template has a new saved revision for future bulletins. Existing bulletins were not changed.",
      );
    } catch (error) {
      setSourceTemplateUpdate({
        ...pending,
        busy: false,
        error: error instanceof Error
          ? `The source template was not updated. ${error.message}`
          : "The source template was not updated. Try again after checking the bulletin library.",
      });
    }
  }

  async function createTemplate(
    document: CbbDocument,
    suffix = "template",
    decisions?: TemplateValueDecisions,
  ): Promise<void> {
    const name = `${document.name} ${suffix}`;
    const created = await onCreateResource(
      createTemplateFromDocument(document, name, decisions),
      "template",
    );
    if (created !== undefined) {
      setActionMessage(`${created.displayName} was saved in Templates.`);
    }
  }

  if (restoredBuffers === undefined) {
    return (
      <div className="cbb-theme cbb-document-loading" data-cbb-theme={settings.theme} role="status">
        <strong>Opening {loaded.displayName}</strong>
        <span>Restoring protected unfinished values…</span>
      </div>
    );
  }

  if (weeklyWorkflowTest !== undefined) {
    return (
      <WeeklyWorkflowSandbox
        source={weeklyWorkflowTest}
        settings={settings}
        idPort={idPort}
        onExit={() => {
          setWeeklyWorkflowTest(undefined);
          setActionMessage("Weekly workflow test closed. Its test values were discarded.");
        }}
        {...(weeklyWorkflowTest.kind !== "template" || readOnly ? {} : {
          onApplyAuthoringChanges: (document: CbbDocument) => {
            try {
              if (store.getSnapshot().mode !== "customizeLayout") {
                store.setMode("customizeLayout");
              }
              const result = store.execute(createApplyTemplateAuthoringChangesCommand({ document }));
              if (result.status === "denied") {
                setActionMessage(result.denial.reason);
                return;
              }
              setWeeklyWorkflowTest(undefined);
              setActionMessage(result.status === "applied"
                ? "Reviewed authoring changes applied. Test values and review state were discarded."
                : "No template authoring changes needed applying.");
            } catch (error) {
              setActionMessage(error instanceof Error
                ? error.message
                : "Those authoring changes could not be applied safely.");
            }
          },
        })}
      />
    );
  }

  return (
    <div className="cbb-theme cbb-document-page" data-cbb-theme={settings.theme}>
      <a className="cbb-skip-link" href="#cbb-document-editor">Skip to bulletin editor</a>
      <header className="cbb-document-header">
        <div className="cbb-document-header__identity">
          <span className="cbb-document-header__brand">Church Bulletin Builder</span>
          <h1 ref={documentHeadingRef} tabIndex={-1}>{loaded.displayName}</h1>
        </div>
        <div className="cbb-document-header__actions">
          <span
            className={`cbb-save-status cbb-save-status--${saveState.status}`}
            role={saveState.status === "saveFailed" ? "alert" : "status"}
          >
            {saveState.message}
          </span>
          <Button onClick={() => setPreviewOpen((value) => !value)} aria-expanded={previewOpen} aria-controls="cbb-pdf-preview-pane">
            {previewOpen ? "Hide PDF preview" : "Show PDF preview"}
          </Button>
          {readOnly ? null : (
            <Button disabled={saveState.status === "saving"} onClick={() => { void saver.current?.enqueue(store.getSnapshot().document); }}>
              Save now
            </Button>
          )}
          <Button disabled={leaving} onClick={leaveEditor}>Back to library</Button>
        </div>
      </header>
      {readOnly
        ? (
            <p className="cbb-route-notice cbb-route-notice--warning" role="status">
              This bulletin library is open read-only. You can view and navigate it, but editing and saving are disabled.
            </p>
          )
        : null}
      {bufferWarning === undefined
        ? null
        : <p className="cbb-route-notice cbb-route-notice--warning" role="alert">{bufferWarning}</p>}
      {leaveError === undefined
        ? null
        : <p className="cbb-route-notice cbb-route-notice--warning" role="alert">{leaveError}</p>}
      <div
        className={`cbb-document-workbench${previewOpen ? " has-preview" : ""}`}
        id="cbb-document-editor"
        tabIndex={-1}
      >
        <div className="cbb-document-workbench__editor">
          <EditorWorkspace
            store={store}
            documentRevisionToken={durableRevisionToken}
            idPort={idPort}
            readOnly={readOnly}
            initialView={settings.viewMode}
            initialPagePresentation={settings.pagePresentation}
            initialMarginGuides={settings.marginGuides}
            initialSnapping={settings.canvasSnap}
            spellcheckEnabled={settings.offlineSpellcheck}
            spellingDictionary={spellingDictionary}
            {...(readOnly ? {} : { onAddSpellingDictionaryWord: addSpellingDictionaryWord })}
            snapSizePx={snapSizePx}
            assetUrl={(assetRef) => imageUrls.url(assetRef)}
            assetInfo={imageAssetInfo}
            {...(imageLibraryUnavailableReason === undefined ? {} : { imageLibraryUnavailableReason })}
            {...(readOnly ? {} : { restoredEditBuffers: restoredBuffers })}
            {...(readOnly || imageLibraryUnavailableReason !== undefined ? {} : { onChooseImageAsset: chooseReadyImageAsset })}
            {...(readOnly || imageLibraryUnavailableReason !== undefined ? {} : { onRequestImageReplacement: (nodeId: NodeId) => {
              void replaceImage(nodeId);
            } })}
            {...(readOnly ? {} : { onEditBufferChange: (update) => {
              void bufferPersistence.update(update).catch((error: unknown) => {
                setBufferWarning(error instanceof Error
                  ? error.message
                  : "That unfinished value could not be protected locally.");
              });
            } })}
            confirmEnterCustomize={() => confirmAction(
              "Customize Layout can change this bulletin’s structure. These changes affect this bulletin unless you explicitly save a template. Continue?",
            )}
            confirmDelete={(name, containsChildren) => confirmAction(containsChildren
              ? `Delete ${name} and every item inside it? This change can be undone while the bulletin remains open.`
              : `Delete ${name}? This change can be undone while the bulletin remains open.`)}
            confirmTemplateAction={confirmAction}
            {...(readOnly ? {} : {
              onViewStateChange: (view: EditorWorkspaceViewState) => onViewSettingsChange({
                ...settings,
                viewMode: view.view,
                pagePresentation: view.pagePresentation,
                marginGuides: view.marginGuides,
                canvasSnap: view.snapping,
              }),
            })}
            onSaveAsTemplate={(document) => setTemplateValueReview({ kind: "create", bulletin: document })}
            onDuplicateTemplate={(document) => { void createTemplate(document, "copy"); }}
            onTestWeeklyWorkflow={(document) => setWeeklyWorkflowTest(document)}
            {...(sourceTemplateLocalResourceId === undefined || onOpenSourceTemplate === undefined
              ? {}
              : { onOpenSourceTemplate: () => { void openSourceTemplate(); } })}
            {...(sourceTemplateLocalResourceId === undefined || onChangeOnlyThisBulletin === undefined
              ? {}
              : { onChangeOnlyThisBulletin: () => { void changeOnlyThisBulletin(); } })}
            {...(sourceTemplateLocalResourceId === undefined
              ? {}
              : { onUpdateTemplateForFutureBulletins: (document: CbbDocument) => {
                  void beginSourceTemplateUpdate(document);
                } })}
          />
        </div>
        <aside id="cbb-pdf-preview-pane" className="cbb-document-workbench__preview" hidden={!previewOpen} aria-label="Generated PDF preview">
          <PreviewPane
            bridge={bridge}
            localResourceId={loaded.localResourceId}
            refreshToken={previewRefresh}
            enabled={settings.livePreview}
            zoom={previewZoom}
            showTechnicalDetails={settings.technicalPdfDetails}
            {...(selectedSourceElementId === undefined ? {} : { selectedSourceElementId })}
          />
        </aside>
      </div>
      {imageChooserOpen
        ? (
            <ImageAssetChooser
              assets={imageAssets}
              assetUrl={(assetRef) => imageUrls.url(assetRef)}
              busy={imageLibraryBusy}
              importing={imageImportBusy}
              error={imageLibraryError}
              onImport={() => { void importImageIntoChooser(); }}
              onChoose={(assetRef) => finishImageAssetChoice(assetRef)}
              onCancel={() => finishImageAssetChoice(undefined)}
            />
          )
        : null}
      {pendingImageReplacement === undefined
        ? null
        : (
            <ImageReplacementReview
              source={pendingImageReplacement.source}
              displayName={pendingImageReplacement.displayName}
              fit={pendingImageReplacement.fit}
              currentFocalPoint={pendingImageReplacement.currentFocalPoint}
              {...(pendingImageReplacement.destinationAspectRatio === undefined
                ? {}
                : { destinationAspectRatio: pendingImageReplacement.destinationAspectRatio })}
              {...(pendingImageReplacement.alt === undefined
                ? {}
                : { alt: pendingImageReplacement.alt })}
              decorative={pendingImageReplacement.decorative}
              onCancel={() => setPendingImageReplacement(undefined)}
              onConfirm={confirmImageReplacement}
            />
          )}
      {templateValueReview === undefined
        ? null
        : (
            <TemplateValueReview
              document={templateValueReview.bulletin}
              {...(templateValueReview.kind === "sourceUpdate" ? {
                title: "Review weekly values before updating the source template",
                description: "Choose whether this bulletin’s weekly values belong in future bulletins. You will review every template change next.",
                confirmLabel: "Continue to change review",
              } : {})}
              onCancel={() => setTemplateValueReview(undefined)}
              onConfirm={(decisions) => {
                const reviewed = templateValueReview;
                setTemplateValueReview(undefined);
                if (reviewed.kind === "create") {
                  void createTemplate(reviewed.bulletin, "template", decisions);
                  return;
                }
                const candidate = sourceTemplateCandidate(
                  reviewed.bulletin,
                  reviewed.source.document,
                  decisions,
                );
                const creationHash = reviewed.bulletin.sourceTemplate?.sourceDocumentHash;
                setSourceTemplateUpdate({
                  source: reviewed.source,
                  candidate,
                  sourceChangedSinceBulletinCreation: creationHash !== undefined &&
                    creationHash !== canonicalRevisionToken(reviewed.source.document),
                  busy: false,
                });
              }}
            />
          )}
      {sourceTemplateUpdate === undefined
        ? null
        : (
            <SourceTemplateUpdateReview
              source={sourceTemplateUpdate.source.document}
              candidate={sourceTemplateUpdate.candidate}
              sourceChangedSinceBulletinCreation={sourceTemplateUpdate.sourceChangedSinceBulletinCreation}
              busy={sourceTemplateUpdate.busy}
              {...(sourceTemplateUpdate.error === undefined ? {} : { error: sourceTemplateUpdate.error })}
              onCancel={() => {
                if (!sourceTemplateUpdate.busy) setSourceTemplateUpdate(undefined);
              }}
              onConfirm={() => { void confirmSourceTemplateUpdate(); }}
            />
          )}
      {showFirstBulletinTour && onFirstBulletinTourFinished !== undefined
        ? <FirstBulletinTour onFinish={onFirstBulletinTourFinished} />
        : null}
      <LiveRegion message={actionMessage} />
    </div>
  );
}
