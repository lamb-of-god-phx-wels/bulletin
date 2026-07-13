import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IdPort } from "@cbb/core";
import { ApplicationShell, type AppRoute } from "../app-shell/index.js";
import {
  getRendererBridge,
  type RendererBridge,
  type RendererBootstrapState,
  type RendererDocumentSummary,
  type RendererJsonValue,
  type RendererLoadedDocument,
  type RendererResourceKind,
  type RendererWorkspaceSettings,
  type RendererWorkspaceSettingsSnapshot,
} from "../bridge/index.js";
import { Banner, Button, Card } from "../design-system/index.js";
import { HelpCenter } from "../help/index.js";
import { LibraryHome, type LibraryResource } from "../library/index.js";
import {
  FirstRunFlow,
  firstRunFinished,
  findStarter,
  parseFirstRunPreference,
  type FirstRunDraft,
  type FirstRunPreference,
  type FirstRunResult,
  type StarterId,
} from "../onboarding/index.js";
import {
  DEFAULT_UI_SETTINGS,
  SettingsPanel,
  validateUiSettings,
  type UiSettings,
} from "../settings/index.js";
import { DocumentWorkspace } from "./DocumentWorkspace.js";
import {
  createBulletinFromStarter,
  createBulletinFromTemplateDocument,
  createTemplateFromDocument,
  hydrateBrowserPracticeDocument,
  localDateOnly,
} from "./documentFactory.js";
import {
  ChurchLibraryPage,
  CreateBulletinPage,
  DocumentLibraryPage,
  TemplateLibraryPage,
} from "./ResourcePages.js";

interface GlobalSettingsValue {
  readonly version: 1;
  readonly kind: "globalSettings";
  readonly scope?: "application";
  readonly theme?: "light" | "dark" | "system";
  readonly defaultLanguage?: string;
  readonly viewMode?: UiSettings["viewMode"];
  readonly pagePresentation?: UiSettings["pagePresentation"];
  readonly previewZoom?: UiSettings["previewZoom"];
  readonly marginGuides?: boolean;
  readonly livePreview?: boolean;
  readonly technicalPdfDetails?: boolean;
  readonly canvasSnap?: boolean;
  readonly snapGridSize?: string;
  readonly exportFilenamePattern?: string;
  readonly offlineSpellcheck?: boolean;
  readonly displayTimeZone?: string;
  readonly telemetryEnabled?: boolean;
}

export interface RendererApplicationProps {
  readonly bridge?: RendererBridge;
  readonly idPort?: IdPort;
  readonly now?: () => Date;
  readonly confirmAction?: (message: string) => boolean;
  readonly browserDemo?: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function globalSettings(value: RendererJsonValue): GlobalSettingsValue {
  if (!record(value) || value["version"] !== 1 || value["kind"] !== "globalSettings") {
    return { version: 1, kind: "globalSettings", theme: "system", defaultLanguage: "en-US" };
  }
  const theme = value["theme"];
  const viewMode = value["viewMode"];
  const pagePresentation = value["pagePresentation"];
  const previewZoom = value["previewZoom"];
  return {
    version: 1,
    kind: "globalSettings",
    ...(value["scope"] === "application" ? { scope: "application" as const } : {}),
    ...(theme === "light" || theme === "dark" || theme === "system" ? { theme } : {}),
    ...(typeof value["defaultLanguage"] === "string" ? { defaultLanguage: value["defaultLanguage"] } : {}),
    ...(viewMode === "page" || viewMode === "contiguous" ? { viewMode } : {}),
    ...(pagePresentation === "single" || pagePresentation === "facing" ? { pagePresentation } : {}),
    ...(previewZoom === "fitPage" || previewZoom === "fitWidth" ||
      (typeof previewZoom === "number" && Number.isSafeInteger(previewZoom) && previewZoom >= 25 && previewZoom <= 200)
      ? { previewZoom: previewZoom as UiSettings["previewZoom"] }
      : {}),
    ...(typeof value["marginGuides"] === "boolean" ? { marginGuides: value["marginGuides"] } : {}),
    ...(typeof value["livePreview"] === "boolean" ? { livePreview: value["livePreview"] } : {}),
    ...(typeof value["technicalPdfDetails"] === "boolean" ? { technicalPdfDetails: value["technicalPdfDetails"] } : {}),
    ...(typeof value["canvasSnap"] === "boolean" ? { canvasSnap: value["canvasSnap"] } : {}),
    ...(typeof value["snapGridSize"] === "string" ? { snapGridSize: value["snapGridSize"] } : {}),
    ...(typeof value["exportFilenamePattern"] === "string" ? { exportFilenamePattern: value["exportFilenamePattern"] } : {}),
    ...(typeof value["offlineSpellcheck"] === "boolean" ? { offlineSpellcheck: value["offlineSpellcheck"] } : {}),
    ...(typeof value["displayTimeZone"] === "string" ? { displayTimeZone: value["displayTimeZone"] } : {}),
    ...(typeof value["telemetryEnabled"] === "boolean" ? { telemetryEnabled: value["telemetryEnabled"] } : {}),
  };
}

function detectedTimeZone(): string {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return value.length > 0 ? value : "UTC";
  } catch {
    return "UTC";
  }
}

function effectiveSettings(
  value: GlobalSettingsValue,
  workspace?: RendererWorkspaceSettingsSnapshot,
): UiSettings {
  const local = workspace?.value;
  return {
    ...DEFAULT_UI_SETTINGS,
    theme: value.theme ?? DEFAULT_UI_SETTINGS.theme,
    language: value.defaultLanguage ?? DEFAULT_UI_SETTINGS.language,
    viewMode: local?.viewMode ?? value.viewMode ?? DEFAULT_UI_SETTINGS.viewMode,
    pagePresentation: local?.pagePresentation ?? value.pagePresentation ?? DEFAULT_UI_SETTINGS.pagePresentation,
    previewZoom: local?.previewZoom ?? value.previewZoom ?? DEFAULT_UI_SETTINGS.previewZoom,
    marginGuides: local?.marginGuides ?? value.marginGuides ?? DEFAULT_UI_SETTINGS.marginGuides,
    livePreview: local?.livePreview ?? value.livePreview ?? DEFAULT_UI_SETTINGS.livePreview,
    technicalPdfDetails: local?.technicalPdfDetails ?? value.technicalPdfDetails ?? DEFAULT_UI_SETTINGS.technicalPdfDetails,
    canvasSnap: local?.canvasSnap ?? value.canvasSnap ?? DEFAULT_UI_SETTINGS.canvasSnap,
    canvasSnapGridSize: local?.snapGridSize ?? value.snapGridSize ?? DEFAULT_UI_SETTINGS.canvasSnapGridSize,
    exportFilenamePattern: local?.exportFilenamePattern ?? value.exportFilenamePattern ?? DEFAULT_UI_SETTINGS.exportFilenamePattern,
    offlineSpellcheck: local?.offlineSpellcheck ?? value.offlineSpellcheck ?? DEFAULT_UI_SETTINGS.offlineSpellcheck,
    displayTimeZone: local?.displayTimeZone ?? value.displayTimeZone ?? detectedTimeZone(),
  };
}

function serializedGlobalSettings(value: GlobalSettingsValue): RendererJsonValue {
  return {
    version: 1,
    kind: "globalSettings",
    scope: "application",
    ...(value.theme === undefined ? {} : { theme: value.theme }),
    ...(value.defaultLanguage === undefined ? {} : { defaultLanguage: value.defaultLanguage }),
    ...(value.viewMode === undefined ? {} : { viewMode: value.viewMode }),
    ...(value.pagePresentation === undefined ? {} : { pagePresentation: value.pagePresentation }),
    ...(value.previewZoom === undefined ? {} : { previewZoom: value.previewZoom }),
    ...(value.marginGuides === undefined ? {} : { marginGuides: value.marginGuides }),
    ...(value.livePreview === undefined ? {} : { livePreview: value.livePreview }),
    ...(value.technicalPdfDetails === undefined ? {} : { technicalPdfDetails: value.technicalPdfDetails }),
    ...(value.canvasSnap === undefined ? {} : { canvasSnap: value.canvasSnap }),
    ...(value.snapGridSize === undefined ? {} : { snapGridSize: value.snapGridSize }),
    ...(value.exportFilenamePattern === undefined ? {} : { exportFilenamePattern: value.exportFilenamePattern }),
    ...(value.offlineSpellcheck === undefined ? {} : { offlineSpellcheck: value.offlineSpellcheck }),
    ...(value.displayTimeZone === undefined ? {} : { displayTimeZone: value.displayTimeZone }),
    ...(value.telemetryEnabled === undefined ? {} : { telemetryEnabled: value.telemetryEnabled }),
  };
}

function defaultIdPort(): IdPort {
  return {
    randomUuid() {
      return crypto.randomUUID();
    },
  };
}

function isLoopbackDemo(): boolean {
  if (typeof window === "undefined") return false;
  return (window.location.protocol === "http:" || window.location.protocol === "https:") &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname) &&
    window.churchBulletinBuilder === undefined;
}

function modifiedLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Edited recently";
  return `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(parsed))}`;
}

function libraryResource(summary: RendererDocumentSummary): LibraryResource {
  return {
    id: summary.localResourceId,
    kind: summary.resourceKind,
    name: summary.displayName,
    modifiedLabel: modifiedLabel(summary.modifiedAt),
    stateLabel: "Ready to edit",
    ...(summary.resourceKind === "template"
      ? { description: "Saved editable template" }
      : {}),
  };
}

function StartupFailure({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="cbb-theme cbb-startup-state" data-cbb-theme="system">
      <Card className="cbb-startup-card">
        <h1>Church Bulletin Builder could not open</h1>
        <p role="alert">{message}</p>
        <Button variant="primary" onClick={onRetry}>Try again</Button>
      </Card>
    </div>
  );
}

export function RendererApplication({
  bridge: suppliedBridge,
  idPort: suppliedIdPort,
  now = () => new Date(),
  confirmAction,
  browserDemo = isLoopbackDemo(),
}: RendererApplicationProps) {
  const bridge = useMemo(() => suppliedBridge ?? getRendererBridge(), [suppliedBridge]);
  const idPort = useMemo(() => suppliedIdPort ?? defaultIdPort(), [suppliedIdPort]);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string>();
  const [documents, setDocuments] = useState<readonly RendererDocumentSummary[]>([]);
  const [bootstrap, setBootstrap] = useState<RendererBootstrapState>();
  const [settings, setSettings] = useState<UiSettings>({
    ...DEFAULT_UI_SETTINGS,
    displayTimeZone: detectedTimeZone(),
  });
  const [globalValue, setGlobalValue] = useState<GlobalSettingsValue>({ version: 1, kind: "globalSettings" });
  const [workspaceSettings, setWorkspaceSettings] = useState<RendererWorkspaceSettingsSnapshot>();
  const [settingsStatus, setSettingsStatus] = useState<string>();
  const [route, setRoute] = useState<AppRoute>("thisWeek");
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<RendererLoadedDocument>();
  const [openingId, setOpeningId] = useState<string>();
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const alive = useRef(true);
  const workspaceSettingsRef = useRef<RendererWorkspaceSettingsSnapshot | undefined>(undefined);
  const workspaceSettingsSaveTail = useRef<Promise<void>>(Promise.resolve());
  const onboardingInFlight = useRef(false);
  const returnFocusResourceId = useRef<string | undefined>(undefined);
  const restoreResourceFocus = useRef(false);

  const refreshDocuments = useCallback(async (): Promise<readonly RendererDocumentSummary[]> => {
    const next = await bridge.listDocuments("all");
    if (alive.current) setDocuments(next);
    return next;
  }, [bridge]);

  const mutateWorkspaceSettings = useCallback((
    mutate: (value: RendererWorkspaceSettings) => RendererWorkspaceSettings,
  ): Promise<RendererWorkspaceSettingsSnapshot> => {
    const operation = async (): Promise<RendererWorkspaceSettingsSnapshot> => {
      let snapshot = workspaceSettingsRef.current ?? await bridge.readWorkspaceSettings();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const outcome = await bridge.writeWorkspaceSettings(
          mutate(snapshot.value),
          snapshot.revisionToken,
        );
        if (outcome.status === "saved") {
          const saved = { value: outcome.value, revisionToken: outcome.revisionToken };
          workspaceSettingsRef.current = saved;
          if (alive.current) setWorkspaceSettings(saved);
          return saved;
        }
        if (outcome.status !== "conflicted" || attempt === 2) {
          throw new Error(outcome.message);
        }
        snapshot = await bridge.readWorkspaceSettings();
        workspaceSettingsRef.current = snapshot;
        if (alive.current) setWorkspaceSettings(snapshot);
      }
      throw new Error("Workspace settings changed repeatedly. Try again.");
    };
    const queued = workspaceSettingsSaveTail.current.then(operation, operation);
    workspaceSettingsSaveTail.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [bridge]);

  const saveSourceTemplateLink = useCallback(async (
    bulletinLocalResourceId: string,
    templateLocalResourceId: string,
  ): Promise<void> => {
    await mutateWorkspaceSettings((value) => ({
      ...value,
      sourceTemplateLinks: [
        ...(value.sourceTemplateLinks ?? []).filter((link) =>
          link.bulletinLocalResourceId !== bulletinLocalResourceId
        ),
        { bulletinLocalResourceId, templateLocalResourceId },
      ].sort((left, right) => left.bulletinLocalResourceId.localeCompare(
        right.bulletinLocalResourceId,
        "en-US",
      )),
    }));
  }, [mutateWorkspaceSettings]);

  const removeSourceTemplateLink = useCallback(async (
    bulletinLocalResourceId: string,
  ): Promise<void> => {
    await mutateWorkspaceSettings((value) => {
      const sourceTemplateLinks = (value.sourceTemplateLinks ?? []).filter((link) =>
        link.bulletinLocalResourceId !== bulletinLocalResourceId
      );
      const { sourceTemplateLinks: _oldLinks, ...withoutLinks } = value;
      return sourceTemplateLinks.length === 0
        ? withoutLinks as RendererWorkspaceSettings
        : { ...withoutLinks, sourceTemplateLinks };
    });
  }, [mutateWorkspaceSettings]);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (opened !== undefined || !restoreResourceFocus.current) return;
    const target = [...document.querySelectorAll<HTMLButtonElement>("[data-resource-open-id]")]
      .find((candidate) => candidate.dataset["resourceOpenId"] === returnFocusResourceId.current);
    if (target === undefined) return;
    restoreResourceFocus.current = false;
    target.focus();
  }, [documents, opened]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setStartupError(undefined);
    void Promise.all([
      bridge.readBootstrapState(),
      bridge.listDocuments("all"),
      bridge.readAppSettings().catch(() => ({ version: 1, kind: "globalSettings", theme: "system" } as const)),
      bridge.readWorkspaceSettings(),
    ]).then(([nextBootstrap, nextDocuments, rawSettings, workspace]) => {
      if (!active) return;
      const global = globalSettings(rawSettings);
      setBootstrap(nextBootstrap);
      setDocuments(nextDocuments);
      setGlobalValue(global);
      workspaceSettingsRef.current = workspace;
      setWorkspaceSettings(workspace);
      setSettings(effectiveSettings(global, workspace));
      setLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setStartupError(error instanceof Error ? error.message : "Your bulletin library is unavailable.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [bootAttempt, bridge]);

  const createResource = useCallback(async (
    document: RendererLoadedDocument["document"],
    resourceKind: RendererResourceKind,
    reservedLocalResourceId?: string,
  ): Promise<RendererLoadedDocument | undefined> => {
    if (bootstrap?.workspaceAccess !== "readWrite") {
      setAlertMessage("This bulletin library is open read-only. Creating, duplicating, and editing are disabled.");
      return undefined;
    }
    const localResourceId = reservedLocalResourceId ?? idPort.randomUuid();
    setStatusMessage(`Creating ${document.name}…`);
    setAlertMessage("");
    try {
      const outcome = await bridge.saveDocument({
        localResourceId,
        resourceKind,
        displayName: document.name,
        document,
        baseRevisionToken: null,
      });
      if (outcome.status !== "saved") {
        setAlertMessage(outcome.message);
        return undefined;
      }
      const loaded = await bridge.loadDocument(localResourceId);
      await refreshDocuments();
      setStatusMessage(`${loaded.displayName} created`);
      return loaded;
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "That item could not be created.");
      return undefined;
    }
  }, [bootstrap?.workspaceAccess, bridge, idPort, refreshDocuments]);

  const openSummary = useCallback(async (summary: RendererDocumentSummary): Promise<void> => {
    setOpeningId(summary.localResourceId);
    setAlertMessage("");
    try {
      let loaded = await bridge.loadDocument(summary.localResourceId);
      if (browserDemo) {
        const hydrated = hydrateBrowserPracticeDocument(loaded.document, idPort);
        if (hydrated !== loaded.document) {
          const saved = await bridge.saveDocument({
            localResourceId: loaded.localResourceId,
            resourceKind: loaded.resourceKind,
            displayName: loaded.displayName,
            document: hydrated,
            baseRevisionToken: loaded.revisionToken,
          });
          loaded = {
            ...loaded,
            document: hydrated,
            ...(saved.status === "saved" ? { revisionToken: saved.revisionToken } : {}),
          };
        }
      }
      returnFocusResourceId.current = loaded.localResourceId;
      setOpened(loaded);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "That item could not be opened.");
    } finally {
      setOpeningId(undefined);
    }
  }, [bridge, browserDemo, idPort]);

  const createStarterBulletin = useCallback(async (
    starterId: StarterId,
    displayName?: string,
    openWhenCreated = true,
  ): Promise<RendererLoadedDocument | undefined> => {
    const document = createBulletinFromStarter({
      starterId,
      idPort,
      publicationDate: localDateOnly(now()),
      ...(displayName === undefined ? {} : { displayName }),
    });
    const loaded = await createResource(document, "bulletin");
    if (loaded !== undefined) {
      setCreating(false);
      returnFocusResourceId.current = loaded.localResourceId;
      if (openWhenCreated) setOpened(loaded);
    }
    return loaded;
  }, [createResource, idPort, now]);

  const persistFirstRun = useCallback(async (
    value: FirstRunPreference,
    announce = true,
  ): Promise<boolean> => {
    if (announce) {
      setStatusMessage("Saving bulletin-library setup…");
      setAlertMessage("");
    }
    try {
      await mutateWorkspaceSettings((current) => ({
          ...current,
          scope: "workspace",
          firstRun: value,
      }));
      return true;
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "Setup choices could not be saved.");
    }
    return false;
  }, [mutateWorkspaceSettings]);

  const persistOnboardingProgress = useCallback((draft: FirstRunDraft): void => {
    void persistFirstRun(draft, false);
  }, [persistFirstRun]);

  const persistChurchProfile = useCallback(async (result: FirstRunResult): Promise<boolean> => {
    const updates = {
      ...(result.churchName === undefined ? {} : { churchName: result.churchName }),
      ...(result.mailingAddress === undefined ? {} : { mailingAddress: result.mailingAddress }),
      ...(result.locationAddress === undefined ? {} : { locationAddress: result.locationAddress }),
      ...(result.phone === undefined ? {} : { phone: result.phone }),
      ...(result.email === undefined ? {} : { email: result.email }),
      ...(result.website === undefined ? {} : { website: result.website }),
      ...(result.logo === undefined ? {} : { logo: result.logo }),
    };
    if (Object.keys(updates).length === 0) return true;
    setStatusMessage("Saving Church Profile…");
    setAlertMessage("");
    try {
      let snapshot = await bridge.readChurchProfile();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = snapshot.value ?? {
          version: 1 as const,
          kind: "churchProfile" as const,
        };
        const { congregationName: _legacyCongregationName, ...canonicalProfile } = current;
        const unchanged = Object.entries(updates).every(([key, value]) =>
          canonicalProfile[key as keyof typeof canonicalProfile] === value
        ) && current.congregationName === undefined;
        if (unchanged) return true;
        const outcome = await bridge.writeChurchProfile({
          ...canonicalProfile,
          ...updates,
        }, snapshot.revisionToken);
        if (outcome.status === "saved") return true;
        if (outcome.status !== "conflicted" || attempt === 1) {
          setAlertMessage(outcome.message);
          return false;
        }
        snapshot = await bridge.readChurchProfile();
      }
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "Church Profile could not be saved.");
    }
    return false;
  }, [bridge]);

  const createStarterTemplate = useCallback(async (starterId: StarterId): Promise<void> => {
    const starter = findStarter(starterId);
    const document = createTemplateFromDocument(starter.document, starter.name);
    const loaded = await createResource(document, "template");
    if (loaded !== undefined) {
      returnFocusResourceId.current = loaded.localResourceId;
      setOpened(loaded);
    }
  }, [createResource]);

  const createBulletinFromSavedTemplate = useCallback(async (
    summary: RendererDocumentSummary,
  ): Promise<void> => {
    setAlertMessage("");
    try {
      const source = await bridge.loadDocument(summary.localResourceId);
      if (source.resourceKind !== "template" || source.document.kind !== "template") {
        throw new Error("That saved item is not a template.");
      }
      const document = createBulletinFromTemplateDocument(source.document, {
        idPort,
        publicationDate: localDateOnly(now()),
      });
      const loaded = await createResource(document, "bulletin");
      if (loaded !== undefined) {
        try {
          await saveSourceTemplateLink(loaded.localResourceId, source.localResourceId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Workspace metadata could not be saved.";
          setAlertMessage(
            `The bulletin was created and is safe, but its source-template shortcut was not saved. ${detail}`,
          );
        }
        // The source id lives only in workspace settings. Portable document
        // JSON retains hashes and names, never a local resource id.
        returnFocusResourceId.current = summary.localResourceId;
        setOpened(loaded);
      }
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "A bulletin could not be created from that template.");
    }
  }, [bridge, createResource, idPort, now, saveSourceTemplateLink]);

  async function duplicate(summary: RendererDocumentSummary): Promise<void> {
    try {
      const source = await bridge.loadDocument(summary.localResourceId);
      const document = {
        ...source.document,
        name: `${source.document.name} copy`,
        metadata: { ...source.document.metadata, title: `${source.document.name} copy` },
      };
      await createResource(document, summary.resourceKind);
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "That item could not be duplicated.");
    }
  }

  async function completeOnboarding(result: FirstRunResult): Promise<void> {
    if (onboardingInFlight.current) return;
    onboardingInFlight.current = true;
    setOnboardingBusy(true);
    try {
      await workspaceSettingsSaveTail.current;
      if (!await persistChurchProfile(result)) return;
      if (!result.createPracticeBulletin) {
        const saved = await persistFirstRun({
          version: 1,
          disposition: "completed",
          preferredOutput: result.preferredOutput,
          starterId: result.starterId,
          tourCompleted: true,
        });
        if (saved) setStatusMessage("Setup complete. Choose a starter whenever you are ready.");
        return;
      }
      const starter = findStarter(result.starterId);
      const name = result.churchName === undefined
        ? undefined
        : `${result.churchName} — ${localDateOnly(now())}`;
      const loaded = await createStarterBulletin(starter.id, name, false);
      if (loaded === undefined) return;
      const saved = await persistFirstRun({
        version: 1,
        disposition: "completed",
        preferredOutput: result.preferredOutput,
        starterId: result.starterId,
        tourCompleted: false,
        tourBulletinLocalResourceId: loaded.localResourceId,
      });
      if (!saved) {
        setAlertMessage("The practice bulletin was created, but the tour choice could not be saved. You can still use the bulletin normally.");
      }
      returnFocusResourceId.current = loaded.localResourceId;
      setOpened(loaded);
    } finally {
      onboardingInFlight.current = false;
      setOnboardingBusy(false);
    }
  }

  async function skipOnboarding(nextAction?: "starter" | "blank"): Promise<void> {
    if (onboardingInFlight.current) return;
    onboardingInFlight.current = true;
    setOnboardingBusy(true);
    try {
      await workspaceSettingsSaveTail.current;
      const saved = await persistFirstRun({
        version: 1,
        disposition: "skipped",
        tourCompleted: true,
      });
      if (saved) {
        setStatusMessage("Setup skipped. You can start from any built-in starter.");
        if (nextAction === "starter") setCreating(true);
        if (nextAction === "blank") await createStarterBulletin("blank-accessible");
      }
    } finally {
      onboardingInFlight.current = false;
      setOnboardingBusy(false);
    }
  }

  async function chooseWorkspaceLocation(): Promise<void> {
    if (onboardingInFlight.current) return;
    onboardingInFlight.current = true;
    setOnboardingBusy(true);
    setAlertMessage("");
    try {
      await workspaceSettingsSaveTail.current;
      const outcome = await bridge.chooseWorkspaceLocation();
      if (outcome.status === "unavailable") {
        setAlertMessage(outcome.message);
      } else if (outcome.status === "canceled") {
        setStatusMessage("Kept the recommended bulletin-library location");
      } else {
        setStatusMessage("Restarting with the chosen bulletin-library location…");
      }
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : "Another bulletin-library location could not be chosen.");
    } finally {
      onboardingInFlight.current = false;
      setOnboardingBusy(false);
    }
  }

  async function finishFirstBulletinTour(): Promise<void> {
    const current = parseFirstRunPreference(
      record(workspaceSettings?.value) ? workspaceSettings.value["firstRun"] : undefined,
    );
    if (current?.disposition !== "completed") return;
    const saved = await persistFirstRun({ ...current, tourCompleted: true });
    if (saved) setStatusMessage("First bulletin tour complete");
  }

  function persistEditorViewSettings(next: UiSettings): void {
    setSettings(next);
    if (bootstrap?.workspaceAccess !== "readWrite") return;

    const saveView = async (): Promise<void> => {
      try {
        let snapshot = workspaceSettingsRef.current ?? await bridge.readWorkspaceSettings();
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const outcome = await bridge.writeWorkspaceSettings({
            ...snapshot.value,
            scope: "workspace",
            viewMode: next.viewMode,
            pagePresentation: next.pagePresentation,
            marginGuides: next.marginGuides,
            canvasSnap: next.canvasSnap,
          }, snapshot.revisionToken);
          if (outcome.status === "saved") {
            const saved = { value: outcome.value, revisionToken: outcome.revisionToken };
            workspaceSettingsRef.current = saved;
            if (alive.current) setWorkspaceSettings(saved);
            return;
          }
          if (outcome.status !== "conflicted" || attempt === 1) {
            if (alive.current) {
              setAlertMessage(`The editor view changed for this session, but its preference was not saved. ${outcome.message}`);
            }
            return;
          }
          snapshot = await bridge.readWorkspaceSettings();
          workspaceSettingsRef.current = snapshot;
          if (alive.current) setWorkspaceSettings(snapshot);
        }
      } catch (error) {
        if (alive.current) {
          const message = error instanceof Error ? error.message : "The view preference could not be saved.";
          setAlertMessage(`The editor view changed for this session, but its preference was not saved. ${message}`);
        }
      }
    };
    workspaceSettingsSaveTail.current = workspaceSettingsSaveTail.current.then(saveView, saveView);
  }

  async function saveSettings(): Promise<void> {
    if (Object.keys(validateUiSettings(settings)).length > 0) {
      setSettingsStatus("Fix the highlighted settings before saving.");
      return;
    }
    setSettingsStatus("Saving settings…");
    const nextGlobal: GlobalSettingsValue = {
      ...globalValue,
      version: 1,
      kind: "globalSettings",
      scope: "application",
      theme: settings.theme,
      defaultLanguage: settings.language,
    };
    try {
      await workspaceSettingsSaveTail.current;
      const saved = globalSettings(await bridge.writeAppSettings(serializedGlobalSettings(nextGlobal)));
      setGlobalValue(saved);
      const currentWorkspaceSettings = workspaceSettingsRef.current ?? workspaceSettings;
      if (currentWorkspaceSettings !== undefined) {
        const workspaceOutcome = await bridge.writeWorkspaceSettings({
          ...currentWorkspaceSettings.value,
          scope: "workspace",
          viewMode: settings.viewMode,
          pagePresentation: settings.pagePresentation,
          previewZoom: settings.previewZoom,
          marginGuides: settings.marginGuides,
          livePreview: settings.livePreview,
          technicalPdfDetails: settings.technicalPdfDetails,
          canvasSnap: settings.canvasSnap,
          snapGridSize: settings.canvasSnapGridSize,
          exportFilenamePattern: settings.exportFilenamePattern,
          offlineSpellcheck: settings.offlineSpellcheck,
          displayTimeZone: settings.displayTimeZone,
        }, currentWorkspaceSettings.revisionToken);
        if (workspaceOutcome.status !== "saved") {
          setSettingsStatus(workspaceOutcome.message);
          return;
        }
        const savedWorkspaceSettings = {
          value: workspaceOutcome.value,
          revisionToken: workspaceOutcome.revisionToken,
        };
        workspaceSettingsRef.current = savedWorkspaceSettings;
        setWorkspaceSettings(savedWorkspaceSettings);
      }
      setSettingsStatus("Settings saved on this computer");
    } catch (error) {
      setSettingsStatus(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  if (loading) {
    return (
      <div className="cbb-theme cbb-startup-state" data-cbb-theme={settings.theme} role="status">
        <Card className="cbb-startup-card"><strong>Opening your bulletin library…</strong></Card>
      </div>
    );
  }
  if (startupError !== undefined) {
    return <StartupFailure message={startupError} onRetry={() => setBootAttempt((value) => value + 1)} />;
  }
  if (opened !== undefined) {
    const openedFirstRun = parseFirstRunPreference(
      record(workspaceSettings?.value) ? workspaceSettings.value["firstRun"] : undefined,
    );
    const showFirstBulletinTour = openedFirstRun?.disposition === "completed" &&
      openedFirstRun.tourCompleted === false &&
      openedFirstRun.tourBulletinLocalResourceId === opened.localResourceId;
    const sourceTemplateLink = opened.resourceKind === "bulletin"
      ? workspaceSettings?.value.sourceTemplateLinks?.find((link) =>
          link.bulletinLocalResourceId === opened.localResourceId
        )
      : undefined;
    return (
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess={bootstrap?.workspaceAccess ?? "readOnly"}
        loaded={opened}
        settings={settings}
        idPort={idPort}
        onBack={() => {
          restoreResourceFocus.current = true;
          setOpened(undefined);
          void refreshDocuments();
        }}
        onCreateResource={createResource}
        onViewSettingsChange={persistEditorViewSettings}
        {...(sourceTemplateLink === undefined ? {} : {
          sourceTemplateLocalResourceId: sourceTemplateLink.templateLocalResourceId,
          onOpenSourceTemplate: async () => {
            const source = await bridge.loadDocument(sourceTemplateLink.templateLocalResourceId);
            if (source.resourceKind !== "template" || source.document.kind !== "template") {
              throw new Error(
                "The saved source reference no longer points to a template. This bulletin is still safe and independent.",
              );
            }
            returnFocusResourceId.current = opened.localResourceId;
            setOpened(source);
          },
          onChangeOnlyThisBulletin: async () => {
            await removeSourceTemplateLink(opened.localResourceId);
          },
        })}
        showFirstBulletinTour={showFirstBulletinTour}
        onFirstBulletinTourFinished={() => { void finishFirstBulletinTour(); }}
        {...(confirmAction === undefined ? {} : { confirmAction })}
      />
    );
  }

  const editable = bootstrap?.workspaceAccess === "readWrite";
  const firstRun = parseFirstRunPreference(
    record(workspaceSettings?.value) ? workspaceSettings.value["firstRun"] : undefined,
  );
  const showOnboarding = editable && documents.length === 0 && !firstRunFinished(
    record(workspaceSettings?.value) ? workspaceSettings.value["firstRun"] : undefined,
  );
  const bulletins = documents.filter((document) => document.resourceKind === "bulletin");
  const templates = documents.filter((document) => document.resourceKind === "template");
  const resources = documents.map(libraryResource);

  let content;
  if (showOnboarding) {
    content = (
      <FirstRunFlow
        onComplete={(result) => { void completeOnboarding(result); }}
        onSkip={() => { void skipOnboarding(); }}
        onUseStarter={() => { void skipOnboarding("starter"); }}
        onStartBlank={() => { void skipOnboarding("blank"); }}
        onProgress={persistOnboardingProgress}
        {...(firstRun?.disposition === "inProgress" ? { initialValue: firstRun as FirstRunDraft } : {})}
        onChooseWorkspaceLocation={() => { void chooseWorkspaceLocation(); }}
        onImportLogo={async () => {
          const outcome = await bridge.importImageAsset();
          if (outcome.status === "canceled") return undefined;
          if (outcome.status !== "imported") throw new Error(outcome.message);
          return {
            assetRef: outcome.asset.assetRef,
            displayName: outcome.asset.displayName,
          };
        }}
        busy={onboardingBusy}
      />
    );
  } else if (creating) {
    content = <CreateBulletinPage onCreate={(starterId) => { void createStarterBulletin(starterId); }} onCancel={() => setCreating(false)} />;
  } else {
    switch (route) {
      case "thisWeek":
        content = (
          <LibraryHome
            resources={resources}
            {...(editable ? {
              onCreateBulletin: () => setCreating(true),
              onStartBlank: () => { void createStarterBulletin("blank-accessible"); },
            } : {})}
            onOpen={(resource) => {
              const summary = documents.find((document) => document.localResourceId === resource.id);
              if (summary !== undefined) void openSummary(summary);
            }}
            {...(editable ? { onDuplicate: (resource: LibraryResource) => {
              const summary = documents.find((document) => document.localResourceId === resource.id);
              if (summary !== undefined) void duplicate(summary);
            } } : {})}
            onShowAll={() => setRoute("bulletins")}
          />
        );
        break;
      case "bulletins":
        content = (
          <DocumentLibraryPage
            title="Bulletins"
            description="Open current and recent bulletins stored in this library."
            documents={bulletins}
            onOpen={(summary) => { void openSummary(summary); }}
            {...(editable ? {
              onDuplicate: (summary: RendererDocumentSummary) => { void duplicate(summary); },
              onCreateBulletin: () => setCreating(true),
            } : {})}
          />
        );
        break;
      case "templates":
        content = (
          <TemplateLibraryPage
            documents={templates}
            onOpen={(summary) => { void openSummary(summary); }}
            {...(editable ? {
              onCreateBulletin: (summary: RendererDocumentSummary) => { void createBulletinFromSavedTemplate(summary); },
              onDuplicate: (summary: RendererDocumentSummary) => { void duplicate(summary); },
              onUseStarter: (starterId: StarterId) => { void createStarterTemplate(starterId); },
            } : {})}
          />
        );
        break;
      case "churchLibrary":
        content = <ChurchLibraryPage />;
        break;
      case "settings":
        content = (
          <SettingsPanel
            value={settings}
            onChange={setSettings}
            onSave={() => { void saveSettings(); }}
            {...(settingsStatus === undefined ? {} : { statusMessage: settingsStatus })}
          />
        );
        break;
      case "help":
        content = <HelpCenter />;
        break;
    }
  }

  return (
    <ApplicationShell
      currentRoute={route}
      focusKey={`${route}:${showOnboarding ? "onboarding" : creating ? "create" : "library"}`}
      onNavigate={(next) => {
        setCreating(false);
        setRoute(next);
      }}
      workspaceName="Your bulletin library"
      theme={settings.theme}
      statusMessage={statusMessage}
      alertMessage={alertMessage}
      headerActions={openingId === undefined
        ? undefined
        : <span role="status">Opening…</span>}
    >
      {browserDemo
        ? (
            <Banner tone="info" title="Browser demo">
              Changes in this demo last only until you reload the page. Start the desktop app to keep a bulletin on this computer.
            </Banner>
          )
        : null}
      {!editable
        ? (
            <Banner tone="warning" title="Read-only library">
              You can open and navigate bulletins, but creating, duplicating, editing, and saving are disabled.
            </Banner>
          )
        : null}
      {alertMessage.length === 0
        ? null
        : <Banner tone="danger" title="Action needed">{alertMessage}</Banner>}
      {content}
    </ApplicationShell>
  );
}
