import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { DocumentView } from "./components/DocumentView";
import { BookletPreview } from "./components/BookletPreview";
import { WeeklyEditor } from "./components/WeeklyEditor";
import { TemplateBuilder } from "./components/TemplateBuilder";
import { TemplateSwitcher } from "./components/TemplateSwitcher";
import { ChurchYearView } from "./components/ChurchYearView";
import { PageTemplatesView } from "./components/PageTemplatesView";
import {
  PreviewZoomControls,
  stepPreviewZoom,
} from "./components/PreviewZoomControls";
import {
  CreateFromDialog,
  type CreationSource,
} from "./components/CreateFromDialog";
import { ImageAssetDialog } from "./components/ImageAssetDialog";
import { LibraryBrowserDialog } from "./components/LibraryBrowserDialog";
import { LibraryFontProvider } from "./components/LibraryFonts";
import { createBulletin, defaultTemplate } from "./shared/defaults";
import { libraryFamilies, type LibraryFamily } from "./shared/library";
import { paginate } from "./shared/pagination";
import { flattenBlocks, updateBlockTree } from "./shared/blocks";
import { paragraphsFromPlainText } from "./shared/plainText";
import {
  duplicateTemplate,
  nextTemplateVersion,
  sortedTemplateRecords,
  templateChoices,
  templateForReference,
  templateFromBulletin,
  templateVersions,
  type TemplateRecord,
} from "./shared/templates";
import type {
  AppUpdateStatus,
  ArchivedWorkspaceRecord,
  BulletinRevisionRecord,
  BulletinDocumentV1,
  EditingState,
  LibraryItemV1,
  LibraryManifestV1,
  TemplateV1,
  ValidationIssue,
  WorkspaceConflict,
  WorkspaceSummary,
} from "./shared/types";
import { validateBulletin } from "./shared/validation";
import { templateForBulletin } from "./shared/documentLayout";
import { randomId } from "./shared/id";
import { prepackagedComponentDefinitions, prepackagedComponentDiagnostics } from "./componentDefinitions";
import { libraryCatalogRecords, setCatalogEntry, type LibraryCatalogRecord, type LibraryRecordType } from "./shared/libraryCatalog";
import { imageFolderDescendantIds } from "./shared/images";
import {
  churchEventDisplayName,
  churchEventsForDate,
} from "./shared/churchCalendar";
import {
  duplicateBulletin,
  filterBulletins,
  sortedBulletins,
  type BulletinRecord,
} from "./shared/bulletins";
import {
  isRedoShortcut,
  isUndoShortcut,
  UndoRedoButtons,
  useUndoRedoHistory,
} from "./components/useUndoRedo";
import { RichTextToolbar } from "./components/RichTextEditing";

type Screen =
  | "weekly"
  | "templates"
  | "page-templates"
  | "library"
  | "church-year"
  | "archive";
type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  action(): Promise<void>;
};
type BulletinConflictState = {
  path: string;
  document: BulletinDocumentV1;
  message: string;
};
type UnsavedBulletinPrompt = {
  action(): void | Promise<void>;
};
type LibraryDraft = {
  id: string;
  title: string;
  kind: LibraryItemV1["kind"];
  text: string;
  notice: string;
  asset?: NonNullable<LibraryItemV1["assets"]>[number];
};
const emptyLibraryDraft = (): LibraryDraft => ({
  id: "",
  title: "",
  kind: "song",
  text: "",
  notice: "",
});
const libraryContentText = (item: LibraryItemV1) =>
  item.content
    ?.map((paragraph) =>
      paragraph.children
        .map((child) =>
          child.type === "text"
            ? child.text
            : child.type === "lineBreak"
              ? "\n"
              : "✠",
        )
        .join(""),
    )
    .join("\n\n") ?? "";
const storedPreviewZoom = () => {
  const raw = localStorage.getItem("bulletin-preview-zoom");
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0.1 && value <= 2
    ? value
    : undefined;
};

function UpdateBanner({
  status,
  hasUnsavedChanges,
  onInstall,
  onLater,
  onRetry,
}: {
  status: AppUpdateStatus;
  hasUnsavedChanges: boolean;
  onInstall(): void;
  onLater(): void;
  onRetry(): void;
}) {
  const version = status.availableVersion ? ` ${status.availableVersion}` : "";
  const message =
    status.phase === "checking"
      ? "Checking for updates…"
      : status.phase === "available"
        ? `Bulletin Builder${version} is available. Preparing the download…`
        : status.phase === "downloading"
          ? `Downloading Bulletin Builder${version}… ${Math.round(status.percent ?? 0)}%`
          : status.phase === "ready"
            ? hasUnsavedChanges
              ? `Bulletin Builder${version} is ready. Finish or close unsaved edits before restarting.`
              : `Bulletin Builder${version} is ready to install.`
            : status.phase === "up-to-date"
              ? `Bulletin Builder ${status.currentVersion} is up to date.`
              : (status.message ?? "The update check failed.");
  return (
    <aside
      className={`update-banner ${status.phase}`}
      role={status.phase === "error" ? "alert" : "status"}
    >
      <div>
        <b>
          {status.phase === "ready"
            ? "Update ready"
            : status.phase === "error"
              ? "Update unavailable"
              : "App update"}
        </b>
        <span>{message}</span>
        {status.phase === "downloading" && (
          <progress max="100" value={status.percent ?? 0} />
        )}
        {status.phase === "ready" && status.releaseNotes && (
          <small>{status.releaseNotes}</small>
        )}
      </div>
      <div>
        {status.phase === "error" && (
          <button className="secondary" onClick={onRetry}>
            Retry
          </button>
        )}
        {status.phase === "ready" && (
          <button
            className="primary"
            disabled={hasUnsavedChanges}
            onClick={onInstall}
          >
            Install and restart
          </button>
        )}
        {(status.phase === "ready" ||
          status.phase === "error" ||
          status.phase === "up-to-date") && (
          <button className="text-button" onClick={onLater}>
            {status.phase === "ready" ? "Later" : "Dismiss"}
          </button>
        )}
      </div>
    </aside>
  );
}

export default function App() {
  const [printMode, setPrintMode] = useState(
    () => new URLSearchParams(location.search).get("print") === "1",
  );
  useEffect(() => {
    const openPrint = () => setPrintMode(true);
    const syncLocation = () =>
      setPrintMode(new URLSearchParams(location.search).get("print") === "1");
    window.addEventListener("bulletin:open-print", openPrint);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("bulletin:open-print", openPrint);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);
  if (printMode) return <PrintApp />;
  return <DesktopApp />;
}

function DesktopApp() {
  const initialPreviewZoom = storedPreviewZoom();
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [screen, setScreen] = useState<Screen>("weekly");
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [document, setDocument] = useState<BulletinDocumentV1>();
  const [relativePath, setRelativePath] = useState("");
  const [template, setTemplate] = useState<TemplateV1>(defaultTemplate);
  const [templatePath, setTemplatePath] = useState("");
  const [status, setStatus] = useState("Ready");
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [bulletinPicker, setBulletinPicker] = useState(false);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<
    Array<{ root: string; name: string }>
  >([]);
  const [exportIssues, setExportIssues] = useState<ValidationIssue[]>([]);
  const [exporting, setExporting] = useState(false);
  const [bookletPreview, setBookletPreview] = useState(false);
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [showRulers, setShowRulers] = useState(
    () => localStorage.getItem("bulletin-show-rulers") !== "false",
  );
  const [showGuides, setShowGuides] = useState(
    () => localStorage.getItem("bulletin-show-guides") === "true",
  );
  const [previewZoom, setPreviewZoom] = useState(initialPreviewZoom ?? 0.72);
  const [createDestination, setCreateDestination] = useState<
    "bulletin" | "template"
  >();
  const [syncCenter, setSyncCenter] = useState(false);
  const [bulletinConflict, setBulletinConflict] =
    useState<BulletinConflictState>();
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({
    phase: "disabled",
    currentVersion: "development",
  });
  const [dismissedUpdate, setDismissedUpdate] = useState<string>();
  const [editingState, setEditingState] = useState<EditingState>({
    bulletinDirty: false,
    templateDirty: false,
    auxiliaryDirty: false,
  });
  const [autosave, setAutosave] = useState(
    () => localStorage.getItem("bulletin-autosave") !== "false",
  );
  const [savingBulletin, setSavingBulletin] = useState(false);
  const [unsavedBulletinPrompt, setUnsavedBulletinPrompt] =
    useState<UnsavedBulletinPrompt>();
  const documentHistory = useUndoRedoHistory<BulletinDocumentV1>();
  const templateHistory = useUndoRedoHistory<TemplateV1>();
  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);
  const previewZoomMode = useRef<"page" | "width" | "manual">(
    initialPreviewZoom === undefined ? "page" : "manual",
  );
  const dirty = useRef(false);
  const templateDirty = useRef(false);
  const auxiliaryDirty = useRef(false);
  const savedRevision = useRef(0);
  const bulletinEditSequence = useRef(0);
  const bulletinSaveInFlight = useRef<Promise<boolean> | undefined>(undefined);
  const statusSequence = useRef(0);
  const editorFocusTimer = useRef<number | undefined>(undefined);
  const previewFocusTimer = useRef<number | undefined>(undefined);
  const reportStatus = (message: string) => {
    statusSequence.current += 1;
    setStatus(message);
  };
  const updateEditingState = (changes: Partial<EditingState>) => {
    const next = {
      bulletinDirty: dirty.current,
      templateDirty: templateDirty.current,
      auxiliaryDirty: auxiliaryDirty.current,
      ...changes,
    };
    dirty.current = next.bulletinDirty;
    templateDirty.current = next.templateDirty;
    auxiliaryDirty.current = next.auxiliaryDirty;
    setEditingState(next);
    window.bulletin?.reportEditingState?.(next);
  };

  useEffect(() => {
    const root = localStorage.getItem("bulletin-workspace");
    if (
      window.bulletin?.platform === "electron" &&
      root?.startsWith("local:")
    ) {
      localStorage.removeItem("bulletin-workspace");
      return;
    }
    if (root) void loadWorkspace(root);
    else if (window.bulletin?.platform === "browser")
      void window.bulletin.chooseWorkspace().then((next) => {
        if (next) return loadWorkspace(next);
      });
  }, []);

  useEffect(() => {
    if (!window.bulletin) return;
    void window.bulletin.getUpdateStatus?.().then(setUpdateStatus);
    return window.bulletin.onUpdateStatus?.(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (!workspace || screen === "library") return;
    const container = window.document.querySelector<HTMLElement>(
      ".preview-pane, .builder-preview",
    );
    const stack = container?.querySelector<HTMLElement>(".document-stack");
    if (!container || !stack) return;
    const applyActiveFit = () => {
      if (previewZoomMode.current !== "manual")
        fitPreview(previewZoomMode.current, container);
    };
    const timer = window.setTimeout(applyActiveFit);
    const observer = new ResizeObserver(applyActiveFit);
    observer.observe(stack);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [workspace, document, screen, showRulers]);

  async function saveCurrentBulletin(createCheckpoint = false) {
    if (
      !dirty.current ||
      !document ||
      !workspace ||
      !window.bulletin ||
      !relativePath
    )
      return !dirty.current;
    if (bulletinSaveInFlight.current) return bulletinSaveInFlight.current;
    const saveSequence = ++statusSequence.current;
    setStatus("Saving…");
    setSavingBulletin(true);
    const currentDocument = document;
    const currentPath = relativePath;
    const currentRoot = workspace.root;
    const editSequenceAtSave = bulletinEditSequence.current;
    const operation = (async () => {
      const expected = savedRevision.current;
      try {
        const result = await window.bulletin!.saveBulletin(
          currentRoot,
          currentPath,
          currentDocument,
          expected,
        );
        savedRevision.current = result.revision;
        const savedDocument = {
          ...currentDocument,
          revision: result.revision,
          updatedAt: result.updatedAt,
        };
        let checkpointFailed = false;
        if (createCheckpoint) {
          const createdAt = new Date().toISOString();
          try {
            const revisionPath = await window.bulletin!.createRevision(
              currentRoot,
              currentPath,
              savedDocument,
              "manual save",
            );
            setWorkspace((current) =>
              current
                ? {
                    ...current,
                    revisions: [
                      {
                        path: revisionPath,
                        bulletinPath: currentPath,
                        label: "manual save",
                        createdAt,
                        document: savedDocument,
                      },
                      ...(current.revisions ?? []),
                    ],
                  }
                : current,
            );
          } catch {
            checkpointFailed = true;
          }
        }
        const changedDuringSave =
          bulletinEditSequence.current !== editSequenceAtSave;
        if (changedDuringSave) {
          setDocument((current) =>
            current
              ? {
                  ...current,
                  revision: result.revision,
                  updatedAt: result.updatedAt,
                }
              : current,
          );
          updateEditingState({ bulletinDirty: true });
        } else {
          setDocument(savedDocument);
          updateEditingState({ bulletinDirty: false });
        }
        setWorkspace((current) =>
          current
            ? {
                ...current,
                bulletins: current.bulletins.some(
                  (item) => item.path === currentPath,
                )
                  ? current.bulletins.map((item) =>
                      item.path === currentPath
                        ? { path: currentPath, document: savedDocument }
                        : item,
                    )
                  : [
                      ...current.bulletins,
                      { path: currentPath, document: savedDocument },
                    ],
              }
            : current,
        );
        if (statusSequence.current === saveSequence)
          setStatus(
            changedDuringSave
              ? "Unsaved changes"
              : checkpointFailed
                ? "Saved · history checkpoint failed"
                : "Saved",
          );
        return !changedDuringSave;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (/conflict/i.test(message))
          setBulletinConflict({
            path: currentPath,
            document: currentDocument,
            message,
          });
        reportStatus(message);
        return false;
      } finally {
        setSavingBulletin(false);
      }
    })();
    bulletinSaveInFlight.current = operation;
    try {
      return await operation;
    } finally {
      bulletinSaveInFlight.current = undefined;
    }
  }

  useEffect(() => {
    if (!autosave || !dirty.current || unsavedBulletinPrompt) return;
    const timer = window.setTimeout(() => void saveCurrentBulletin(), 700);
    return () => window.clearTimeout(timer);
  }, [autosave, document, relativePath, workspace, unsavedBulletinPrompt]);

  useEffect(() => {
    if (!workspace || !window.bulletin?.onWorkspaceChanged) return;
    return window.bulletin.onWorkspaceChanged((change) => {
      if (change.root !== workspace.root) return;
      if (dirty.current || templateDirty.current || auxiliaryDirty.current) {
        reportStatus("Shared workspace changed — save or reload to review it");
        return;
      }
      void window
        .bulletin!.openWorkspace(workspace.root)
        .then((next) => {
          setWorkspace(next);
          const nextDocument = next.bulletins.find(
            (item) => item.path === relativePath,
          );
          if (
            nextDocument &&
            nextDocument.document.revision !== savedRevision.current
          ) {
            documentHistory.reset();
            setDocument(nextDocument.document);
            savedRevision.current = nextDocument.document.revision;
          }
          const nextTemplate = next.templates.find(
            (item) => item.path === templatePath,
          );
          if (nextTemplate) {
            templateHistory.reset();
            setTemplate(nextTemplate.template);
          }
          const conflicts = next.sync?.conflicts.length ?? 0;
          const pending = next.sync?.unavailableAssets.length ?? 0;
          reportStatus(
            conflicts
              ? `${conflicts} shared conflict${conflicts === 1 ? "" : "s"} need attention`
              : pending
                ? `${pending} asset${pending === 1 ? "" : "s"} waiting for synchronization`
                : "Shared workspace refreshed",
          );
        })
        .catch((error) =>
          reportStatus(error instanceof Error ? error.message : String(error)),
        );
    });
  }, [workspace?.root, relativePath, templatePath]);

  async function loadWorkspace(root: string) {
    if (!window.bulletin) return;
    try {
      const next = await window.bulletin.openWorkspace(root);
      documentHistory.reset();
      templateHistory.reset();
      setWorkspace(next);
      updateEditingState({
        bulletinDirty: false,
        templateDirty: false,
        auxiliaryDirty: false,
      });
      localStorage.setItem("bulletin-workspace", root);
      const selectedTemplate =
        templateChoices(next.templates)[0] ??
        sortedTemplateRecords(next.templates)[0];
      setTemplate(selectedTemplate?.template ?? defaultTemplate);
      setTemplatePath(selectedTemplate?.path ?? "");
      const latest = [...next.bulletins].sort((a, b) =>
        b.document.info.date.localeCompare(a.document.info.date),
      )[0];
      if (latest) openDocument(latest.document, latest.path, next.templates);
      else if (next.compatibility?.writable !== false)
        startNew(selectedTemplate?.template ?? defaultTemplate);
      if (next.sync?.conflicts.length)
        reportStatus(
          `${next.sync.conflicts.length} shared conflict${next.sync.conflicts.length === 1 ? "" : "s"} need attention`,
        );
      else if (next.sync?.unavailableAssets.length)
        reportStatus(
          `${next.sync.unavailableAssets.length} asset${next.sync.unavailableAssets.length === 1 ? "" : "s"} waiting for synchronization`,
        );
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  }
  async function chooseWorkspaceNow() {
    if (!window.bulletin) return;
    if (window.bulletin.platform === "browser") {
      setAvailableWorkspaces((await window.bulletin.listWorkspaces?.()) ?? []);
      setWorkspacePicker(true);
      return;
    }
    try {
      const root = await window.bulletin.chooseWorkspace();
      if (root) await loadWorkspace(root);
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  }
  function chooseWorkspace() {
    requestBulletinLeave(chooseWorkspaceNow);
  }
  function selectTemplate(record: TemplateRecord) {
    templateHistory.reset();
    setTemplate(record.template);
    setTemplatePath(record.path);
    updateEditingState({ templateDirty: false });
  }
  function openDocument(
    next: BulletinDocumentV1,
    path: string,
    records = workspace?.templates ?? [],
  ) {
    const record = templateForReference(records, next.template);
    if (record) selectTemplate(record);
    documentHistory.reset();
    setDocument(next);
    bulletinEditSequence.current += 1;
    setRelativePath(path);
    savedRevision.current = next.revision;
    updateEditingState({ bulletinDirty: false });
    reportStatus("Saved");
    setScreen("weekly");
  }
  function showWeekly() {
    if (document) {
      const record = templateForReference(
        workspace?.templates ?? [],
        document.template,
      );
      if (record) selectTemplate(record);
    }
    setScreen("weekly");
  }
  function openNewBulletin(next: BulletinDocumentV1) {
    const calendarEvents = workspace?.library?.calendarEvents ?? [];
    const firstEvent = churchEventsForDate(
      next.info.date,
      calendarEvents,
    )[0];
    next = {
      ...next,
      info: {
        ...next.info,
        churchWeek: firstEvent
          ? churchEventDisplayName(firstEvent, next.info.date, calendarEvents)
          : "",
        churchEventId: firstEvent?.id,
      },
    };
    const base = `bulletins/${next.info.date}/bulletin.json`;
    const path = workspace?.bulletins.some((item) => item.path === base)
      ? `bulletins/${next.info.date}/bulletin-${Date.now()}.json`
      : base;
    openDocument(next, path);
    updateEditingState({ bulletinDirty: true });
    reportStatus("Unsaved changes");
  }
  function startNew(from = template) {
    openNewBulletin(createBulletin(from));
  }
  function beginNewBulletin() {
    requestBulletinLeave(() => setCreateDestination("bulletin"));
  }
  function changeDocument(next: BulletinDocumentV1) {
    if (!document || next === document) return;
    documentHistory.record(document);
    applyDocumentHistoryValue(next);
  }
  function applyDocumentHistoryValue(next: BulletinDocumentV1) {
    bulletinEditSequence.current += 1;
    updateEditingState({ bulletinDirty: true });
    setExportIssues([]);
    reportStatus("Unsaved changes");
    setDocument(next);
  }
  function undoDocument() {
    if (!document) return;
    const previous = documentHistory.undo(document);
    if (previous) applyDocumentHistoryValue(previous);
  }
  function redoDocument() {
    if (!document) return;
    const next = documentHistory.redo(document);
    if (next) applyDocumentHistoryValue(next);
  }
  function changeTemplate(next: TemplateV1) {
    if (next === template) return;
    templateHistory.record(template);
    applyTemplateHistoryValue(next);
  }
  function applyTemplateHistoryValue(next: TemplateV1) {
    updateEditingState({ templateDirty: true });
    reportStatus("Unsaved changes");
    setTemplate(next);
  }
  function undoTemplate() {
    const previous = templateHistory.undo(template);
    if (previous) applyTemplateHistoryValue(previous);
  }
  function redoTemplate() {
    const next = templateHistory.redo(template);
    if (next) applyTemplateHistoryValue(next);
  }
  function discardCurrentBulletinChanges() {
    const saved = workspace?.bulletins.find(
      (item) => item.path === relativePath,
    );
    if (saved) {
      documentHistory.reset();
      setDocument(saved.document);
      savedRevision.current = saved.document.revision;
    } else {
      documentHistory.reset();
      setDocument(undefined);
      setRelativePath("");
      savedRevision.current = 0;
    }
    updateEditingState({ bulletinDirty: false });
    reportStatus("Changes discarded");
  }
  function requestBulletinLeave(action: () => void | Promise<void>) {
    if (!dirty.current) {
      void action();
      return;
    }
    if (bulletinSaveInFlight.current) {
      void saveCurrentBulletin().then((saved) => {
        if (saved) void action();
        else requestBulletinLeave(action);
      });
      return;
    }
    setUnsavedBulletinPrompt({ action });
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.(".modal-backdrop")) return;
      if (
        window.document.querySelector(
          ".canvas-designer, .page-template-designer, .block-formatting-modal",
        )
      )
        return;
      if (screen === "weekly" && isUndoShortcut(event)) {
        event.preventDefault();
        undoDocument();
        return;
      }
      if (screen === "weekly" && isRedoShortcut(event)) {
        event.preventDefault();
        redoDocument();
        return;
      }
      if (screen === "templates" && isUndoShortcut(event)) {
        event.preventDefault();
        undoTemplate();
        return;
      }
      if (screen === "templates" && isRedoShortcut(event)) {
        event.preventDefault();
        redoTemplate();
        return;
      }
      if (
        screen === "weekly" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "s"
      ) {
        event.preventDefault();
        void saveCurrentBulletin();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [screen, document, template, relativePath, workspace]);

  useEffect(() => {
    if (
      window.bulletin?.platform === "electron" &&
      window.bulletin.onCloseRequested
    ) {
      return window.bulletin.onCloseRequested(() =>
        requestBulletinLeave(() => window.bulletin?.confirmClose?.()),
      );
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [document, relativePath, workspace, editingState.bulletinDirty]);
  async function deleteCurrentBulletin() {
    if (!document || !workspace || !window.bulletin) return;
    try {
      updateEditingState({ bulletinDirty: false });
      await window.bulletin.deleteBulletin(workspace.root, relativePath);
      const remaining = workspace.bulletins.filter(
        (item) => item.path !== relativePath,
      );
      setWorkspace({ ...workspace, bulletins: remaining });
      const latest = [...remaining].sort((a, b) =>
        b.document.info.date.localeCompare(a.document.info.date),
      )[0];
      if (latest) openDocument(latest.document, latest.path);
      else {
        documentHistory.reset();
        setDocument(undefined);
        setRelativePath("");
        savedRevision.current = 0;
      }
      reportStatus("Bulletin moved to Trash");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  }
  function confirmBulletinDelete() {
    if (!document) return;
    setConfirmation({
      title: "Delete bulletin?",
      message: `Do you want to send “${document.info.title}” for ${document.info.date} to Trash? You can restore it later.`,
      confirmLabel: "Delete bulletin",
      action: deleteCurrentBulletin,
    });
  }
  async function performExport() {
    if (!document || !workspace || !window.bulletin) return;
    setExportIssues([]);
    setExporting(true);
    reportStatus("Preparing PDF…");
    try {
      const output = await window.bulletin.exportPdf(
        workspace.root,
        relativePath,
        document,
      );
      reportStatus(
        output
          ? window.bulletin.platform === "browser"
            ? "Opening print preview…"
            : `Exported ${output}`
          : "Export canceled",
      );
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }
  async function exportPdf() {
    if (!document || !workspace || !window.bulletin) return;
    const issues = validateBulletin(
      document,
      workspace.library,
      templateForBulletin(template, document),
    );
    if (issues.length) {
      setExportIssues(issues);
      reportStatus(
        `Review ${issues.length} item${issues.length === 1 ? "" : "s"} before exporting.`,
      );
      return;
    }
    await performExport();
  }
  async function saveTemplate(publish: boolean) {
    if (!workspace || !window.bulletin) return;
    const expectedUpdatedAt = workspace.templates.find(
      (item) => item.path === templatePath,
    )?.template.updatedAt;
    const next = {
      ...(publish
        ? {
            ...template,
            status: "published" as const,
            version: nextTemplateVersion(workspace.templates, template.id),
          }
        : { ...template, status: "draft" as const }),
      updatedAt: new Date().toISOString(),
    };
    try {
      const path = await window.bulletin.saveTemplate(
        workspace.root,
        next,
        publish ? undefined : expectedUpdatedAt,
      );
      updateEditingState({ templateDirty: false });
      setTemplate(next);
      setTemplatePath(path);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              templates: current.templates.some((item) => item.path === path)
                ? current.templates.map((item) =>
                    item.path === path ? { path, template: next } : item,
                  )
                : [...current.templates, { path, template: next }],
            }
          : current,
      );
      reportStatus(`${publish ? "Published" : "Saved"} ${path}`);
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  async function createNewTemplate(source: CreationSource, name: string) {
    if (!workspace || !window.bulletin) return;
    const next =
      source.kind === "template"
        ? duplicateTemplate(source.record.template, name, workspace.templates)
        : templateFromBulletin(
            source.record.document,
            templateForBulletin(
              templateForReference(
                workspace.templates,
                source.record.document.template,
              )?.template ?? template,
              source.record.document,
            ),
            name,
            workspace.templates,
          );
    try {
      const path = await window.bulletin.saveTemplate(workspace.root, next);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              templates: [...current.templates, { path, template: next }],
            }
          : current,
      );
      templateHistory.reset();
      setTemplate(next);
      setTemplatePath(path);
      setScreen("templates");
      reportStatus(`Created ${name}`);
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  function selectAfterTemplateDeletion(
    templates: TemplateRecord[],
    preferredId?: string,
  ) {
    const selected =
      templateChoices(templates).find(
        (item) => item.template.id === preferredId,
      ) ??
      templateChoices(templates)[0] ??
      sortedTemplateRecords(templates)[0];
    if (!selected) return;
    setWorkspace((current) => (current ? { ...current, templates } : current));
    templateHistory.reset();
    setTemplate(selected.template);
    setTemplatePath(selected.path);
  }
  async function deleteCurrentTemplateVersion() {
    if (
      !workspace ||
      !window.bulletin ||
      !templatePath ||
      workspace.templates.length <= 1
    )
      return;
    try {
      await window.bulletin.deleteTemplate(workspace.root, templatePath);
      const templates = workspace.templates.filter(
        (item) => item.path !== templatePath,
      );
      selectAfterTemplateDeletion(templates, template.id);
      reportStatus("Template version moved to Trash");
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  }
  async function deleteCurrentTemplateFamily() {
    if (
      !workspace ||
      !window.bulletin ||
      templateChoices(workspace.templates).length <= 1
    )
      return;
    const versions = templateVersions(workspace.templates, template.id);
    try {
      for (const version of versions)
        await window.bulletin.deleteTemplate(workspace.root, version.path);
      const templates = workspace.templates.filter(
        (item) => item.template.id !== template.id,
      );
      selectAfterTemplateDeletion(templates);
      reportStatus(
        `Moved ${template.name} and ${versions.length} version${versions.length === 1 ? "" : "s"} to Trash`,
      );
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  }
  function confirmTemplateVersionDelete() {
    setConfirmation({
      title: "Delete template version?",
      message: `Do you want to send ${template.name} version ${template.version}${template.status === "draft" ? " draft" : ""} to Trash? You can restore it later. Other versions will remain available.`,
      confirmLabel: "Delete version",
      action: deleteCurrentTemplateVersion,
    });
  }
  function confirmTemplateFamilyDelete() {
    const versions = workspace
      ? templateVersions(workspace.templates, template.id).length
      : 0;
    setConfirmation({
      title: "Delete template?",
      message: `Do you want to send “${template.name}” and all ${versions} version${versions === 1 ? "" : "s"} to Trash? You can restore them later.`,
      confirmLabel: "Delete template",
      action: deleteCurrentTemplateFamily,
    });
  }
  function toggleRulers() {
    setShowRulers((current) => {
      const next = !current;
      localStorage.setItem("bulletin-show-rulers", String(next));
      return next;
    });
  }
  function toggleGuides() {
    setShowGuides((current) => {
      const next = !current;
      localStorage.setItem("bulletin-show-guides", String(next));
      return next;
    });
  }
  function changePreviewZoom(zoom: number) {
    previewZoomMode.current = "manual";
    setPreviewZoom(zoom);
    localStorage.setItem("bulletin-preview-zoom", String(zoom));
  }
  function fitPreview(mode: "width" | "page", container: HTMLElement | null) {
    const stack = container?.querySelector<HTMLElement>(".document-stack");
    if (!stack) return;
    const rulerWidth = showRulers ? 46 : 0;
    const rulerHeight = showRulers ? 75 : 0;
    const fitWidth = (stack.clientWidth - 48 - rulerWidth) / 672;
    const fitPage = Math.min(
      fitWidth,
      (stack.clientHeight - 56 - rulerHeight) / 816,
    );
    const zoom =
      Math.round(
        Math.max(0.1, Math.min(2, mode === "width" ? fitWidth : fitPage)) *
          1000,
      ) / 1000;
    previewZoomMode.current = mode;
    setPreviewZoom(zoom);
    localStorage.setItem("bulletin-preview-zoom", String(zoom));
  }
  function handlePreviewWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    previewZoomMode.current = "manual";
    setPreviewZoom((current) => {
      const next = stepPreviewZoom(current, event.deltaY < 0 ? 1 : -1);
      localStorage.setItem("bulletin-preview-zoom", String(next));
      return next;
    });
  }
  function focusEditorBlock(blockId: string) {
    const editor = window.document.querySelector<HTMLElement>(
      screen === "templates" ? ".template-workbench" : ".editor-pane",
    );
    const candidates = [
      ...(editor?.querySelectorAll<HTMLElement>("[data-editor-block-id]") ??
        []),
    ];
    const target = candidates.find((element) => element.dataset.editorBlockId === blockId)
      ?? candidates.filter(element => blockId.startsWith(`${element.dataset.editorBlockId}-`))
        .sort((left, right) => (right.dataset.editorBlockId?.length ?? 0) - (left.dataset.editorBlockId?.length ?? 0))[0];
    if (!target || !editor) return;
    if (editorFocusTimer.current !== undefined)
      window.clearTimeout(editorFocusTimer.current);
    editor
      .querySelectorAll(".editor-block-focus")
      .forEach((element) => element.classList.remove("editor-block-focus"));
    target.classList.remove("editor-block-focus");
    void target.offsetWidth;
    target.classList.add("editor-block-focus");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    editorFocusTimer.current = window.setTimeout(() => {
      target.classList.remove("editor-block-focus");
      editorFocusTimer.current = undefined;
    }, 1800);
  }
  function focusPreviewBlock(blockId: string) {
    const preview = window.document.querySelector<HTMLElement>(
      screen === "templates" ? ".builder-preview" : ".preview-pane",
    );
    const target = [
      ...(preview?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []),
    ].find((element) => element.dataset.blockId === blockId);
    if (!target || !preview) return;
    if (previewFocusTimer.current !== undefined)
      window.clearTimeout(previewFocusTimer.current);
    preview
      .querySelectorAll(".preview-block-focus")
      .forEach((element) => element.classList.remove("preview-block-focus"));
    target.classList.remove("preview-block-focus");
    void target.offsetWidth;
    target.classList.add("preview-block-focus");
    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    previewFocusTimer.current = window.setTimeout(() => {
      target.classList.remove("preview-block-focus");
      previewFocusTimer.current = undefined;
    }, 1800);
  }
  function handleEditorBlockClick(event: ReactMouseEvent<HTMLElement>) {
    const block = (event.target as Element).closest<HTMLElement>(
      "[data-editor-block-id]",
    );
    if (
      block &&
      event.currentTarget.contains(block) &&
      block.dataset.editorBlockId
    )
      focusPreviewBlock(block.dataset.editorBlockId);
  }

  if (!workspace)
    return (
      <div className="welcome-screen">
        <div className="brand-mark">✠</div>
        <div className="eyebrow">Bulletin Builder</div>
        <h1>
          Sunday’s bulletin,
          <br />
          without the busywork.
        </h1>
        <p>Choose the folder where your church keeps its bulletins.</p>
        <button className="primary large" onClick={chooseWorkspace}>
          Choose bulletin workspace
        </button>
      </div>
    );

  const pageCount = document
    ? paginate(
        document.blocks,
        templateForBulletin(template, document),
        workspace.library,
      ).length
    : 0;
  const issues = document
    ? validateBulletin(
        document,
        workspace.library,
        templateForBulletin(template, document),
      )
    : [];
  const statusIsError =
    /blocked|conflict|required|failed|error|missing|unavailable|does not|could not|invalid|enter |choose |paste |fetch /i.test(
      status,
    );
  const workspaceName =
    availableWorkspaces.find((item) => item.root === workspace.root)?.name ??
    (workspace.root.startsWith("local:")
      ? workspace.root.slice(6).replaceAll("-", " ")
      : workspace.root);
  const workspaceWritable = workspace.compatibility?.writable !== false;
  const documentUndoCommands = {
    canUndo: documentHistory.canUndo,
    canRedo: documentHistory.canRedo,
    undo: undoDocument,
    redo: redoDocument,
  };
  const templateUndoCommands = {
    canUndo: templateHistory.canUndo,
    canRedo: templateHistory.canRedo,
    undo: undoTemplate,
    redo: redoTemplate,
  };
  const updateKey = `${updateStatus.phase}:${updateStatus.availableVersion ?? updateStatus.currentVersion}`;
  const updateVisible =
    ["available", "downloading", "ready", "error"].includes(
      updateStatus.phase,
    ) && dismissedUpdate !== updateKey;
  const checkForUpdates = async () => {
    setDismissedUpdate(undefined);
    try {
      const next = await window.bulletin?.checkForUpdates?.();
      if (next) setUpdateStatus(next);
      if (next?.phase === "up-to-date")
        reportStatus(`Bulletin Builder ${next.currentVersion} is up to date`);
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const installUpdate = async () => {
    if (
      editingState.bulletinDirty ||
      editingState.templateDirty ||
      editingState.auxiliaryDirty
    ) {
      reportStatus(
        "Save or close unfinished edits before installing the update.",
      );
      return;
    }
    try {
      await window.bulletin?.installUpdate?.();
    } catch (error) {
      reportStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const editorOpen =
    screen === "templates" || (screen === "weekly" && Boolean(document));
  const trashCount = workspace.sync?.archivedRecords.length ?? 0;
  const navigationItems: Array<{
    label: string;
    icon: string;
    active: boolean;
    count?: number;
    leavesBulletin?: boolean;
    action(): void;
  }> = [
    {
      label: "This week",
      icon: "◫",
      active: screen === "weekly",
      action: showWeekly,
    },
    {
      label: "Bulletins",
      icon: "▦",
      active: false,
      action: () => setBulletinPicker(true),
    },
    {
      label: "Bulletin Templates",
      icon: "◇",
      active: screen === "templates",
      leavesBulletin: true,
      action: () => setScreen("templates"),
    },
    {
      label: "Page Templates",
      icon: "▣",
      active: screen === "page-templates",
      leavesBulletin: true,
      action: () => setScreen("page-templates"),
    },
    {
      label: "Library",
      icon: "▤",
      active: screen === "library",
      leavesBulletin: true,
      action: () => setScreen("library"),
    },
    {
      label: "Church Calendar",
      icon: "◉",
      active: screen === "church-year",
      leavesBulletin: true,
      action: () => setScreen("church-year"),
    },
    {
      label: "Trash",
      icon: "⌫",
      active: screen === "archive",
      count: trashCount,
      leavesBulletin: true,
      action: () => setScreen("archive"),
    },
  ];
  const runNavigationAction = (item: (typeof navigationItems)[number]) => {
    if (item.leavesBulletin && screen === "weekly")
      requestBulletinLeave(item.action);
    else item.action();
  };
  const navigationMenu = (compact = false) => (
    <nav className={compact ? "compact-navigation" : undefined}>
      {navigationItems.map((item) => (
        <button
          className={item.active ? "active" : ""}
          key={item.label}
          aria-label={compact ? item.label : undefined}
          title={compact ? item.label : undefined}
          onClick={() => runNavigationAction(item)}
        >
          <span>{item.icon}</span>
          {!compact && item.label}
          {!compact && item.count ? ` (${item.count})` : ""}
          {compact && item.count ? (
            <small className="navigation-count">{item.count}</small>
          ) : null}
        </button>
      ))}
    </nav>
  );
  const recentBulletins = () => (
    <div className="recent">
      <div className="eyebrow">Recent bulletins</div>
      {sortedBulletins(workspace.bulletins)
        .slice(0, 6)
        .map((item) => (
          <button
            key={item.path}
            onClick={() =>
              requestBulletinLeave(() =>
                openDocument(item.document, item.path),
              )
            }
          >
            <b>
              {new Date(
                `${item.document.info.date}T12:00:00`,
              ).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </b>
            <span>{item.document.info.title}</span>
          </button>
        ))}
    </div>
  );
  const navigationFooter = () => (
    <div className="sidebar-bottom">
      {window.bulletin?.platform === "electron" && (
        <button
          onClick={() => {
            void checkForUpdates();
          }}
        >
          ↻ Check for updates
        </button>
      )}
      <button
        onClick={() => {
          chooseWorkspace();
        }}
      >
        ⌂ Change workspace
      </button>
      <span title={workspace.root}>{workspaceName}</span>
      <small>Version {updateStatus.currentVersion}</small>
    </div>
  );
  return (
    <LibraryFontProvider root={workspace.root} library={workspace.library}><div
      className={`app-shell${editorOpen ? " editor-shell" : ""}${navigationOpen ? " navigation-open" : ""}${workspaceWritable ? "" : " workspace-readonly"}`}
    >
      {editorOpen ? (
        <>
          {navigationOpen ? (
            <aside
              id="app-navigation-drawer"
              className="sidebar navigation-drawer"
              aria-label="Navigation"
            >
              <div className="app-brand">
                <span>✠</span>
                <div>
                  <b>Bulletin</b>
                  <small>Builder</small>
                </div>
                <button
                  className="navigation-close"
                  aria-label="Collapse navigation"
                  title="Collapse navigation"
                  onClick={() => setNavigationOpen(false)}
                >
                  ×
                </button>
              </div>
              {navigationMenu()}
              {recentBulletins()}
              {navigationFooter()}
            </aside>
          ) : (
            <aside className="navigation-rail" aria-label="Quick navigation">
              <button
                className="navigation-toggle"
                aria-label="Expand navigation"
                aria-controls="app-navigation-drawer"
                aria-expanded={false}
                title="Expand navigation"
                onClick={() => setNavigationOpen(true)}
              >
                ☰
              </button>
              {navigationMenu(true)}
              <div className="navigation-rail-bottom">
                {window.bulletin?.platform === "electron" && (
                  <button
                    aria-label="Check for updates"
                    title="Check for updates"
                    onClick={() => void checkForUpdates()}
                  >
                    ↻
                  </button>
                )}
                <button
                  aria-label="Change workspace"
                  title={`Change workspace · ${workspaceName}`}
                  onClick={chooseWorkspace}
                >
                  ⌂
                </button>
              </div>
            </aside>
          )}
          <aside className="elements-sidebar" aria-label="Elements">
            <div
              id="app-element-palette-slot"
              className="sidebar-palette-slot"
            />
          </aside>
        </>
      ) : (
        <aside className="sidebar static-navigation">
          <div className="app-brand">
            <span>✠</span>
            <div>
              <b>Bulletin</b>
              <small>Builder</small>
            </div>
          </div>
          {navigationMenu()}
          {recentBulletins()}
          {navigationFooter()}
        </aside>
      )}
      <main className={`main-area ${screen === "church-year" ? "calendar-main" : ""}`}>
        {screen !== "church-year" && <header className="topbar">
          <div>
            <div className="eyebrow">
              {screen === "weekly"
                ? "Weekly bulletin"
                : screen === "archive"
                    ? "Recoverable items"
                  : screen}
            </div>
            <h1>
              {screen === "weekly"
                ? (document?.info.title ?? "No bulletin selected")
                : screen === "templates"
                  ? template.name
                  : screen === "page-templates"
                    ? "Page Templates"
                    : screen === "archive"
                      ? "Trash"
                      : workspace.library?.name}
            </h1>
          </div>
          <div className="top-actions">
            <span className={`save-status ${statusIsError ? "error" : ""}`}>
              {status}
            </span>
            {(screen === "weekly" || screen === "templates") && (
              <>
                <UndoRedoButtons
                  history={
                    screen === "weekly"
                      ? documentUndoCommands
                      : templateUndoCommands
                  }
                />
                <button
                  type="button"
                  className={`guide-toggle ${showGuides ? "active" : ""}`}
                  aria-label={`${showGuides ? "Hide" : "Show"} guides`}
                  aria-pressed={showGuides}
                  onClick={toggleGuides}
                >
                  Guides
                </button>
                <button
                  type="button"
                  className={`ruler-toggle ${showRulers ? "active" : ""}`}
                  aria-label={`${showRulers ? "Hide" : "Show"} rulers`}
                  aria-pressed={showRulers}
                  onClick={toggleRulers}
                >
                  Rulers
                </button>
              </>
            )}
            {screen === "weekly" && (
              <>
                <label className="autosave-control">
                  <input
                    type="checkbox"
                    checked={autosave}
                    disabled={!workspaceWritable || !document}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setAutosave(enabled);
                      localStorage.setItem(
                        "bulletin-autosave",
                        enabled ? "true" : "false",
                      );
                      reportStatus(
                        enabled
                          ? dirty.current
                            ? "Autosave enabled"
                            : "Autosave on"
                          : dirty.current
                            ? "Autosave off · unsaved changes"
                            : "Autosave off",
                      );
                    }}
                  />
                  Autosave
                </label>
                <button
                  className="secondary"
                  disabled={
                    !workspaceWritable ||
                    !document ||
                    !dirty.current ||
                    savingBulletin
                  }
                  onClick={() => void saveCurrentBulletin(true)}
                >
                  {savingBulletin ? "Saving…" : "Save"}
                </button>
                <button
                  className="secondary"
                  disabled={!document}
                  onClick={async () => {
                    const latest = await window.bulletin!.openWorkspace(workspace.root);
                    setWorkspace(current => current ? { ...current, revisions: latest.revisions ?? [] } : current);
                    setRevisionHistoryOpen(true);
                  }}
                >
                  History
                </button>
                {document && (
                  <button
                    className="danger-text"
                    disabled={!workspaceWritable}
                    onClick={confirmBulletinDelete}
                  >
                    Delete
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={!workspaceWritable}
                  onClick={beginNewBulletin}
                >
                  New week
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !workspaceWritable ||
                    !window.bulletin ||
                    !document ||
                    exporting
                  }
                  onClick={() => void exportPdf()}
                >
                  {exporting
                    ? "Preparing…"
                    : window.bulletin?.platform === "browser"
                      ? "Print / Save PDF"
                      : "Export PDF"}
                </button>
              </>
            )}
          </div>
        </header>}
        {!workspaceWritable && (
          <div className="component-diagnostics-banner" role="alert">
            <b>Update required — read only</b>
            <span>{workspace.compatibility?.message}</span>
          </div>
        )}
        {workspaceWritable && (workspace.sync?.conflicts.length ?? 0) > 0 && (
          <button
            className="component-diagnostics-banner"
            role="status"
            onClick={() => setSyncCenter(true)}
          >
            <b>
              {workspace.sync!.conflicts.length} synchronized conflict
              {workspace.sync!.conflicts.length === 1 ? "" : "s"}
            </b>
            <span>{workspace.sync!.conflicts[0].message} Review copies →</span>
          </button>
        )}
        {workspaceWritable &&
          !(workspace.sync?.conflicts.length ?? 0) &&
          (workspace.sync?.unavailableAssets.length ?? 0) > 0 && (
            <div className="component-diagnostics-banner" role="status">
              <b>Waiting for SharePoint</b>
              <span>
                {workspace.sync!.unavailableAssets.length} referenced asset
                {workspace.sync!.unavailableAssets.length === 1 ? "" : "s"} are
                not available locally yet. The app will retry when
                synchronization changes the workspace.
              </span>
            </div>
          )}
        {workspaceWritable &&
          !(workspace.sync?.conflicts.length ?? 0) &&
          !(workspace.sync?.unavailableAssets.length ?? 0) &&
          prepackagedComponentDiagnostics.length > 0 && (
            <div className="component-diagnostics-banner" role="status">
              <b>
                {prepackagedComponentDiagnostics.length} packaged component
                issue{prepackagedComponentDiagnostics.length === 1 ? "" : "s"}
              </b>
              <span>
                {prepackagedComponentDiagnostics[0].message} The application
                skipped the affected definition and continued.
              </span>
            </div>
          )}
        {screen === "weekly" && document && (
          <div className="weekly-layout">
            <section className="editor-pane" onClick={handleEditorBlockClick}>
              <WeeklyEditor
                document={document}
                template={template}
                pageTemplates={workspace.pageTemplates.map(
                  (record) => record.pageTemplate,
                )}
                library={workspace.library}
                root={workspace.root}
                relativePath={relativePath}
                onChange={changeDocument}
                history={documentUndoCommands}
                onOpenChurchCalendar={() =>
                  requestBulletinLeave(() => setScreen("church-year"))
                }
                onLibraryChange={async (library, alreadySaved) => {
                  if (!window.bulletin) return;
                  try {
                    if (!alreadySaved) await window.bulletin.saveLibrary(workspace.root, library, workspace.library);
                    setWorkspace((current) =>
                      current ? { ...current, library } : current,
                    );
                    reportStatus("Block library saved");
                  } catch (error) {
                    const message =
                      error instanceof Error ? error.message : String(error);
                    reportStatus(message);
                    throw error;
                  }
                }}
                onError={reportStatus}
              />
            </section>
            <section className="preview-pane" onWheel={handlePreviewWheel}>
              <div className="preview-toolbar">
                <div>
                  <b>Print preview</b>
                  <span>{pageCount} pages · 7 × 8.5 in</span>
                </div>
                <PreviewZoomControls
                  zoom={previewZoom}
                  onChange={changePreviewZoom}
                  onFit={(mode) =>
                    fitPreview(
                      mode,
                      window.document.querySelector(".preview-pane"),
                    )
                  }
                />
                <div className="preview-toolbar-end">
                  <button
                    className="secondary booklet-preview-button"
                    onClick={() => setBookletPreview(true)}
                  >
                    Booklet preview
                  </button>
                  <div
                    className={
                      issues.length ? "validation warning" : "validation"
                    }
                  >
                    {issues.length
                      ? `${issues.length} item${issues.length === 1 ? "" : "s"} to finish`
                      : "✓ Ready to export"}
                  </div>
                </div>
                <RichTextToolbar />
              </div>
              <DocumentView
                document={document}
                template={template}
                library={workspace.library}
                root={workspace.root}
                rulers={showRulers}
                guides={showGuides}
                zoom={previewZoom}
                onBlockSelect={focusEditorBlock}
                onBlockChange={workspaceWritable ? (block) => changeDocument({ ...document, blocks: updateBlockTree(document.blocks, block.id, block) }) : undefined}
              />
            </section>
          </div>
        )}
        {screen === "weekly" && !document && (
          <div className="empty-state">
            <span>◫</span>
            <h2>No bulletins yet</h2>
            <p>
              Create a bulletin from one of your templates when you’re ready to
              begin.
            </p>
            <button
              className="primary"
              disabled={!workspaceWritable}
              onClick={beginNewBulletin}
            >
              Create bulletin
            </button>
          </div>
        )}
        {screen === "templates" && (
          <div className="template-screen">
            <div
              className="template-workbench"
              onClick={handleEditorBlockClick}
            >
              <TemplateSwitcher
                records={workspace.templates}
                currentPath={templatePath}
                onSelect={(path) => {
                  const record = workspace.templates.find(
                    (item) => item.path === path,
                  );
                  if (record) selectTemplate(record);
                }}
                onCreate={() => setCreateDestination("template")}
              />
              <TemplateBuilder
                template={template}
                pageTemplates={workspace.pageTemplates.map(
                  (record) => record.pageTemplate,
                )}
                workspaceDefinitions={
                  workspace.library?.componentDefinitions ?? []
                }
                library={workspace.library}
                root={workspace.root}
                onChange={changeTemplate}
                history={templateUndoCommands}
                onDefinitionsChange={async (componentDefinitions) => {
                  if (!window.bulletin) return;
                  const library = {
                    ...(workspace.library ?? {
                      schemaVersion: 1 as const,
                      name: "Shared Library",
                      items: [],
                    }),
                    componentDefinitions,
                  };
                  try {
                    await window.bulletin.saveLibrary(
                      workspace.root,
                      library,
                      workspace.library,
                    );
                    setWorkspace((current) =>
                      current ? { ...current, library } : current,
                    );
                    reportStatus("JSON component library saved");
                  } catch (error) {
                    reportStatus(
                      error instanceof Error ? error.message : String(error),
                    );
                    throw error;
                  }
                }}
                onLibraryChange={async (library, alreadySaved) => {
                  if (!window.bulletin) return;
                  if (!alreadySaved) await window.bulletin.saveLibrary(workspace.root, library, workspace.library);
                  setWorkspace(current => current ? { ...current, library } : current);
                  reportStatus("Image library saved");
                }}
                onSave={saveTemplate}
                onDeleteVersion={confirmTemplateVersionDelete}
                onDeleteTemplate={confirmTemplateFamilyDelete}
                canDeleteVersion={
                  workspace.templates.length > 1 && Boolean(templatePath)
                }
                canDeleteTemplate={
                  templateChoices(workspace.templates).length > 1 &&
                  Boolean(templatePath)
                }
              />
            </div>
            <div className="builder-preview" onWheel={handlePreviewWheel}>
              <div className="preview-toolbar">
                <div>
                  <b>Template preview</b>
                  <span>7 × 8.5 in pages</span>
                </div>
                <PreviewZoomControls
                  zoom={previewZoom}
                  onChange={changePreviewZoom}
                  onFit={(mode) =>
                    fitPreview(
                      mode,
                      window.document.querySelector(".builder-preview"),
                    )
                  }
                />
                <RichTextToolbar />
              </div>
              <DocumentView
                document={createBulletin(template)}
                template={template}
                library={workspace.library}
                root={workspace.root}
                rulers={showRulers}
                guides={showGuides}
                zoom={previewZoom}
                onBlockSelect={focusEditorBlock}
                onBlockChange={workspaceWritable ? (block) => changeTemplate({ ...template, starterBlocks: updateBlockTree(template.starterBlocks, block.id, block) }) : undefined}
              />
            </div>
          </div>
        )}
        {screen === "library" && (
          <LibraryView
            workspace={workspace}
            onDirtyChange={(value) =>
              updateEditingState({ auxiliaryDirty: value })
            }
            onError={reportStatus}
            onOpenExternal={(record, create) => {
              if (record.type === "page-template") {
                setScreen("page-templates");
                reportStatus(create ? "Use New page template to choose a layout" : `Opened ${record.title || "Page Templates"}`);
              } else {
                setScreen("templates");
                reportStatus(create ? "Open Manage components to add a component" : `Open Manage components to edit ${record.title}`);
              }
            }}
            onDeletePages={async (ids, alreadyDeleted) => {
              if (!window.bulletin) return;
              const targets = workspace.pageTemplates.filter(record => ids.includes(record.pageTemplate.id));
              if (!alreadyDeleted) for (const target of targets) await window.bulletin.deletePageTemplate(workspace.root, target.path);
              setWorkspace(current => current ? { ...current, pageTemplates: current.pageTemplates.filter(record => !ids.includes(record.pageTemplate.id)) } : current);
            }}
            onSave={async (library, alreadySaved) => {
              if (!window.bulletin) return;
              try {
                if (!alreadySaved) await window.bulletin.saveLibrary(workspace.root, library, workspace.library);
                setWorkspace({ ...workspace, library });
                reportStatus("Library saved");
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                reportStatus(message);
                throw error;
              }
            }}
          />
        )}
        {screen === "page-templates" && (
          <PageTemplatesView
            records={workspace.pageTemplates}
            template={template}
            document={document}
            library={workspace.library}
            root={workspace.root}
            definitions={workspace.library?.componentDefinitions ?? []}
            onError={reportStatus}
            onLibraryChange={async (library, alreadySaved) => {
              if (!window.bulletin) return;
              if (!alreadySaved) await window.bulletin.saveLibrary(workspace.root, library, workspace.library);
              setWorkspace(current => current ? { ...current, library } : current);
              reportStatus("Image library saved");
            }}
            onSave={async (pageTemplate, expectedUpdatedAt) => {
              if (!window.bulletin)
                throw new Error("Page-template storage is unavailable.");
              const path = await window.bulletin.savePageTemplate(
                workspace.root,
                pageTemplate,
                expectedUpdatedAt,
              );
              const record = { path, pageTemplate };
              setWorkspace((current) =>
                current
                  ? {
                      ...current,
                      pageTemplates: current.pageTemplates.some(
                        (item) => item.path === path,
                      )
                        ? current.pageTemplates.map((item) =>
                            item.path === path ? record : item,
                          )
                        : [...current.pageTemplates, record],
                    }
                  : current,
              );
              reportStatus(
                `${pageTemplate.status === "published" ? "Published" : "Saved"} ${pageTemplate.name}`,
              );
              return record;
            }}
            onArchive={async (record) => {
              await window.bulletin?.deletePageTemplate(
                workspace.root,
                record.path,
              );
              setWorkspace((current) =>
                current
                  ? {
                      ...current,
                      pageTemplates: current.pageTemplates.filter(
                        (item) => item.path !== record.path,
                      ),
                    }
                  : current,
              );
              reportStatus(`Moved ${record.pageTemplate.name} to Trash`);
            }}
          />
        )}
        {screen === "church-year" && (
          <ChurchYearView
            library={
              workspace.library ?? {
                schemaVersion: 1,
                name: "Church Library",
                items: [],
              }
            }
            onDirtyChange={(value) =>
              updateEditingState({ auxiliaryDirty: value })
            }
            onSave={async (library) => {
              if (!window.bulletin) return;
              try {
                await window.bulletin.saveLibrary(
                  workspace.root,
                  library,
                  workspace.library,
                );
                setWorkspace({ ...workspace, library });
                reportStatus("Church Calendar saved");
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                reportStatus(message);
                throw error;
              }
            }}
          />
        )}
        {screen === "archive" && (
          <ArchiveView
            records={workspace.sync?.archivedRecords ?? []}
            onRestore={async (record) => {
              await window.bulletin?.restoreArchived?.(workspace.root, record);
              await loadWorkspace(workspace.root);
              setScreen("archive");
            }}
            onDelete={async (record) => {
              await window.bulletin?.permanentlyDeleteArchived?.(
                workspace.root,
                record,
              );
              await loadWorkspace(workspace.root);
              setScreen("archive");
            }}
          />
        )}
      </main>
      {updateVisible && (
        <UpdateBanner
          status={updateStatus}
          hasUnsavedChanges={
            editingState.bulletinDirty ||
            editingState.templateDirty ||
            editingState.auxiliaryDirty
          }
          onInstall={() => void installUpdate()}
          onLater={() => setDismissedUpdate(updateKey)}
          onRetry={() => void checkForUpdates()}
        />
      )}
      {statusIsError && (
        <div className="error-toast" role="alert">
          <span>!</span>
          <div>
            <b>Something needs attention</b>
            <p>{status}</p>
          </div>
          <button
            aria-label="Dismiss error"
            onClick={() => reportStatus("Ready")}
          >
            ×
          </button>
        </div>
      )}
      {exportIssues.length > 0 && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="export-issues-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-issues-title"
          >
            <header>
              <div>
                <div className="eyebrow">Export checklist</div>
                <h2 id="export-issues-title">
                  Review {exportIssues.length} item
                  {exportIssues.length === 1 ? "" : "s"}
                </h2>
              </div>
              <button
                aria-label="Close export checklist"
                onClick={() => setExportIssues([])}
              >
                ×
              </button>
            </header>
            <div className="export-issue-list">
              {exportIssues.map((issue, index) => (
                <div key={`${issue.path}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <b>{issue.message}</b>
                    <small>{issue.path}</small>
                  </div>
                </div>
              ))}
            </div>
            <footer>
              <p>
                You can return to the editor to fix these items, or export the
                current preview as it appears now.
              </p>
              <div className="export-checklist-actions">
                <button
                  className="secondary"
                  onClick={() => setExportIssues([])}
                >
                  Back to editor
                </button>
                <button
                  className="primary"
                  onClick={() => void performExport()}
                >
                  Export anyway
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {bookletPreview && document && (
        <BookletPreview
          document={document}
          template={template}
          library={workspace.library}
          root={workspace.root}
          onClose={() => setBookletPreview(false)}
        />
      )}
      {revisionHistoryOpen && document && (
        <RevisionHistoryDialog
          revisions={(workspace.revisions ?? []).filter(record => record.bulletinPath === relativePath || record.document.id === document.id)}
          onClose={() => setRevisionHistoryOpen(false)}
          onRestore={async revision => {
            if (dirty.current && !window.confirm("Discard the current unsaved changes and restore this revision?")) return;
            await window.bulletin!.createRevision(workspace.root, relativePath, document, "before restore");
            const restoredInput = { ...revision.document, revision: savedRevision.current, updatedAt: document.updatedAt };
            const saved = await window.bulletin!.saveBulletin(workspace.root, relativePath, restoredInput, savedRevision.current);
            const restored = { ...restoredInput, revision: saved.revision, updatedAt: saved.updatedAt };
            setRevisionHistoryOpen(false);
            openDocument(restored, relativePath, workspace.templates);
            const latest = await window.bulletin!.openWorkspace(workspace.root);
            setWorkspace(latest);
            reportStatus(`Restored revision from ${new Date(revision.createdAt).toLocaleString()}`);
          }}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          confirmation={confirmation}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={async () => {
            const action = confirmation.action;
            setConfirmation(undefined);
            await action();
          }}
        />
      )}
      {unsavedBulletinPrompt && (
        <UnsavedBulletinDialog
          saving={savingBulletin}
          onCancel={() => setUnsavedBulletinPrompt(undefined)}
          onDiscard={async () => {
            const action = unsavedBulletinPrompt.action;
            setUnsavedBulletinPrompt(undefined);
            discardCurrentBulletinChanges();
            await action();
          }}
          onSave={async () => {
            if (!(await saveCurrentBulletin(true))) return;
            const action = unsavedBulletinPrompt.action;
            setUnsavedBulletinPrompt(undefined);
            await action();
          }}
        />
      )}
      {createDestination && (
        <CreateFromDialog
          destination={createDestination}
          templates={sortedTemplateRecords(workspace.templates)}
          bulletins={workspace.bulletins}
          initialTemplatePath={templatePath}
          onCancel={() => setCreateDestination(undefined)}
          onCreate={async (source, value) => {
            if (createDestination === "bulletin") {
              setCreateDestination(undefined);
              const next =
                source.kind === "template"
                  ? createBulletin(source.record.template, value)
                  : duplicateBulletin(source.record.document, value);
              openNewBulletin(next);
            } else {
              await createNewTemplate(source, value);
              setCreateDestination(undefined);
            }
          }}
        />
      )}
      {bulletinPicker && (
        <BulletinPicker
          bulletins={workspace.bulletins}
          currentPath={relativePath}
          onClose={() => setBulletinPicker(false)}
          onSelect={(record) => {
            requestBulletinLeave(() => {
              setBulletinPicker(false);
              openDocument(record.document, record.path);
            });
          }}
        />
      )}
      {workspacePicker && (
        <WorkspacePicker
          workspaces={availableWorkspaces}
          current={workspace.root}
          onClose={() => setWorkspacePicker(false)}
          onSelect={async (root) => {
            requestBulletinLeave(async () => {
              setWorkspacePicker(false);
              await loadWorkspace(root);
            });
          }}
          onCreate={(name) => {
            requestBulletinLeave(async () => {
              try {
                const root = await window.bulletin!.createWorkspace!(name);
                setAvailableWorkspaces(
                  await window.bulletin!.listWorkspaces!(),
                );
                setWorkspacePicker(false);
                await loadWorkspace(root);
              } catch (error) {
                reportStatus(
                  error instanceof Error ? error.message : String(error),
                );
              }
            });
          }}
        />
      )}
      {syncCenter && (
        <SyncCenter
          conflicts={workspace.sync?.conflicts ?? []}
          onClose={() => setSyncCenter(false)}
          onKeep={async (conflict, keepPath) => {
            await window.bulletin?.resolveWorkspaceConflict?.(
              workspace.root,
              conflict,
              keepPath,
            );
            setSyncCenter(false);
            await loadWorkspace(workspace.root);
          }}
        />
      )}
      {bulletinConflict && (
        <BulletinConflictDialog
          conflict={bulletinConflict}
          onDefer={() => setBulletinConflict(undefined)}
          onUseShared={async () => {
            const next = await window.bulletin!.openWorkspace(workspace.root);
            const shared = next.bulletins.find(
              (item) => item.path === bulletinConflict.path,
            );
            setBulletinConflict(undefined);
            setWorkspace(next);
            if (shared)
              openDocument(shared.document, shared.path, next.templates);
          }}
          onKeepCopy={() => {
            const local = bulletinConflict.document;
            const copyPath = `bulletins/${local.info.date}/bulletin-copy-${Date.now()}.json`;
            setBulletinConflict(undefined);
            setRelativePath(copyPath);
            savedRevision.current = 0;
            updateEditingState({ bulletinDirty: true });
            documentHistory.reset();
            setDocument({
              ...local,
              id: randomId(),
              revision: 0,
              updatedAt: new Date().toISOString(),
            });
            reportStatus("Saving conflict copy…");
          }}
          onReplaceShared={async () => {
            const next = await window.bulletin!.openWorkspace(workspace.root);
            const shared = next.bulletins.find(
              (item) => item.path === bulletinConflict.path,
            );
            if (!shared)
              throw new Error("The shared bulletin is no longer available.");
            await window.bulletin!.createRevision(
              workspace.root,
              shared.path,
              shared.document,
              "conflict backup",
            );
            const saved = await window.bulletin!.saveBulletin(
              workspace.root,
              shared.path,
              bulletinConflict.document,
              shared.document.revision,
            );
            const resolved = {
              ...bulletinConflict.document,
              revision: saved.revision,
              updatedAt: saved.updatedAt,
            };
            setBulletinConflict(undefined);
            setWorkspace({
              ...next,
              bulletins: next.bulletins.map((item) =>
                item.path === shared.path
                  ? { path: shared.path, document: resolved }
                  : item,
              ),
            });
            openDocument(resolved, shared.path, next.templates);
          }}
        />
      )}
    </div></LibraryFontProvider>
  );
}

function ConfirmDialog({
  confirmation,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation;
  onCancel(): void;
  onConfirm(): Promise<void>;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="confirmation-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
      >
        <div className="eyebrow">Please confirm</div>
        <h2 id="confirmation-title">{confirmation.title}</h2>
        <p>{confirmation.message}</p>
        <p>This change will synchronize to other workspace users.</p>
        <div>
          <button className="secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className="danger" onClick={() => void onConfirm()}>
            {confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function UnsavedBulletinDialog({
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  saving: boolean;
  onCancel(): void;
  onDiscard(): Promise<void>;
  onSave(): Promise<void>;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="confirmation-modal unsaved-bulletin-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-bulletin-title"
      >
        <div className="eyebrow">Unsaved bulletin</div>
        <h2 id="unsaved-bulletin-title">Save before leaving?</h2>
        <p>
          This bulletin has changes that have not been saved to the shared
          workspace.
        </p>
        <div>
          <button className="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="danger-text"
            disabled={saving}
            onClick={() => void onDiscard()}
          >
            Don&apos;t save
          </button>
          <button
            className="primary"
            autoFocus
            disabled={saving}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>
    </div>
  );
}

function RevisionHistoryDialog({ revisions, onClose, onRestore }: {
  revisions: BulletinRevisionRecord[];
  onClose(): void;
  onRestore(revision: BulletinRevisionRecord): Promise<void>;
}) {
  const [restoring, setRestoring] = useState<string>();
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="revision-history-modal" role="dialog" aria-modal="true" aria-labelledby="revision-history-title">
      <header><div><div className="eyebrow">Bulletin revisions</div><h2 id="revision-history-title">Revision history</h2><p>Manual saves, exports, and safety backups appear here.</p></div><button aria-label="Close revision history" onClick={onClose}>×</button></header>
      {revisions.length ? <ol>{revisions.map(revision => <li key={revision.path}>
        <div><b>{revision.label}</b><span>{new Date(revision.createdAt).toLocaleString()}</span><small>Revision {revision.document.revision} · {revision.document.info.title}</small></div>
        <button className="secondary" disabled={Boolean(restoring)} onClick={async () => { setRestoring(revision.path); try { await onRestore(revision); } finally { setRestoring(undefined); } }}>{restoring === revision.path ? 'Restoring…' : 'Restore'}</button>
      </li>)}</ol> : <p className="empty-state">No saved revisions yet. Use Save or export the bulletin to create one.</p>}
      <footer><button className="secondary" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}

function BulletinPicker({
  bulletins,
  currentPath,
  onClose,
  onSelect,
}: {
  bulletins: BulletinRecord[];
  currentPath: string;
  onClose(): void;
  onSelect(record: BulletinRecord): void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => filterBulletins(bulletins, query),
    [bulletins, query],
  );
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="bulletin-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulletin-picker-title"
      >
        <header>
          <div>
            <div className="eyebrow">Workspace history</div>
            <h2 id="bulletin-picker-title">Choose a bulletin</h2>
            <p>
              {bulletins.length} saved bulletin
              {bulletins.length === 1 ? "" : "s"} in this workspace.
            </p>
          </div>
          <button aria-label="Close bulletin picker" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="bulletin-picker-search">
          <label>
            Search all bulletins
            <input
              autoFocus
              type="search"
              value={query}
              placeholder="Title, series, date, or church event"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span>
            {matches.length} result{matches.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="bulletin-picker-list">
          {matches.map((record) => {
            const current = record.path === currentPath;
            const date = new Date(
              `${record.document.info.date}T12:00:00`,
            ).toLocaleDateString(undefined, {
              weekday: "short",
              month: "long",
              day: "numeric",
              year: "numeric",
            });
            return (
              <button
                className={current ? "current" : ""}
                key={record.path}
                onClick={() => onSelect(record)}
              >
                <time dateTime={record.document.info.date}>
                  <b>{date}</b>
                  <small>{record.document.info.churchWeek}</small>
                </time>
                <span>
                  <b>{record.document.info.title || "Untitled bulletin"}</b>
                  <small>
                    {record.document.info.series || record.document.church.name}
                  </small>
                </span>
                <strong>{current ? "Current" : "Open"}</strong>
              </button>
            );
          })}
          {!matches.length && (
            <div className="bulletin-picker-empty">
              <span>⌕</span>
              <b>No matching bulletins</b>
              <p>Try a title, date, series, or church event.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function WorkspacePicker({
  workspaces,
  current,
  onClose,
  onSelect,
  onCreate,
}: {
  workspaces: Array<{ root: string; name: string }>;
  current: string;
  onClose(): void;
  onSelect(root: string): void;
  onCreate(name: string): void;
}) {
  const [name, setName] = useState("");
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-title"
      >
        <header>
          <div>
            <div className="eyebrow">Local storage</div>
            <h2 id="workspace-title">Choose workspace</h2>
          </div>
          <button aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="workspace-list">
          {workspaces.map((item) => (
            <button
              className={item.root === current ? "selected" : ""}
              key={item.root}
              onClick={() => onSelect(item.root)}
            >
              <span className="workspace-icon">⌂</span>
              <span>
                <b>{item.name}</b>
                <small>
                  {item.root === current
                    ? "Current workspace"
                    : "Stored in this browser"}
                </small>
              </span>
              {item.root === current && <strong>✓</strong>}
            </button>
          ))}
        </div>
        <div className="new-workspace">
          <label>
            New workspace name
            <input
              autoFocus
              value={name}
              placeholder="e.g. Sunday Worship"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) onCreate(name.trim());
              }}
            />
          </label>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
          >
            Create workspace
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryView({
  workspace,
  onSave,
  onError,
  onDirtyChange,
  onOpenExternal,
  onDeletePages,
}: {
  workspace: WorkspaceSummary;
  onSave(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError(message: string): void;
  onDirtyChange?(dirty: boolean): void;
  onOpenExternal(record: LibraryCatalogRecord, create?: boolean): void;
  onDeletePages(ids: string[], alreadyDeleted?: boolean): Promise<void>;
}) {
  const items = workspace.library?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<Confirmation>();
  const [editing, setEditing] = useState<LibraryItemV1>();
  const [managingImages, setManagingImages] = useState(false);
  const [draftFolderId, setDraftFolderId] = useState<string>();
  const [draft, setDraft] = useState<LibraryDraft>(emptyLibraryDraft);
  const [selectedVersions, setSelectedVersions] = useState<
    Record<string, number>
  >({});
  useEffect(() => {
    onDirtyChange?.(adding || Boolean(deleteConfirmation));
    return () => onDirtyChange?.(false);
  }, [adding, deleteConfirmation]);
  const families = useMemo(() => libraryFamilies(items), [items]);
  const groups = useMemo(
    () =>
      families.reduce<Record<string, LibraryFamily[]>>((result, family) => {
        (result[family.kind] ??= []).push(family);
        return result;
      }, {}),
    [families],
  );
  const catalogRecords = useMemo(() => libraryCatalogRecords(
    workspace.library,
    workspace.pageTemplates.map(record => record.pageTemplate),
    prepackagedComponentDefinitions
  ), [workspace.library, workspace.pageTemplates]);
  const selectedItem = (family: LibraryFamily) =>
    family.versions.find(
      (item) => item.version === selectedVersions[family.id],
    ) ?? family.versions[0];
  const chooseAsset = async () => {
    if (!window.bulletin || !draft.id) return;
    try {
      const asset = await window.bulletin.importAsset(
        workspace.root,
        `assets/library/${draft.id}`,
        draft.kind === "font" ? "font" : "page",
      );
      if (asset) setDraft({ ...draft, asset });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  const addItem = async () => {
    const id =
      draft.id ||
      draft.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    if (!id || !draft.title.trim()) {
      onError("Enter a title and stable ID before saving the library item.");
      return;
    }
    if (draft.kind === "font" && !draft.asset) {
      onError("Attach a TTF, OTF, WOFF, or WOFF2 file before saving the font.");
      return;
    }
    const version =
      Math.max(
        0,
        ...items.filter((item) => item.id === id).map((item) => item.version),
      ) + 1;
    const item: LibraryItemV1 = {
      ...(editing?.aliases ? { aliases: editing.aliases } : {}),
      id,
      version,
      kind: draft.kind,
      title: draft.title,
      ...(draft.text
        ? {
            content: paragraphsFromPlainText(draft.text, {
              preserveLineBreaks: draft.kind === "song",
            }),
          }
        : {}),
      ...(draft.notice
        ? {
            license: {
              notice: draft.notice,
              ...(editing?.license?.licenseNumber
                ? { licenseNumber: editing.license.licenseNumber }
                : {}),
            },
          }
        : {}),
      ...(draft.asset
        ? { assets: [draft.asset, ...(editing?.assets?.slice(1) ?? [])] }
        : {}),
    };
    try {
      const nextLibrary = {
        ...(workspace.library ?? { schemaVersion: 1, name: "Church Library" }),
        items: [...items, item],
      };
      await onSave(draftFolderId ? setCatalogEntry(nextLibrary, { targetKind: "library-item", targetId: id, folderId: draftFolderId }) : nextLibrary);
      setSelectedVersions((current) => ({ ...current, [id]: version }));
      setAdding(false);
      setEditing(undefined);
      setDraft(emptyLibraryDraft());
      setDraftFolderId(undefined);
    } catch {
      /* The parent reports the actionable error. */
    }
  };
  const requestDelete = (item: LibraryItemV1) => {
    const newestVersion = Math.max(
      ...items
        .filter((entry) => entry.id === item.id)
        .map((entry) => entry.version),
    );
    const usesItem = (block: BulletinDocumentV1["blocks"][number]) =>
      "libraryItemId" in block &&
      block.libraryItemId === item.id &&
      (block.libraryItemVersion
        ? block.libraryItemVersion === item.version
        : item.version === newestVersion);
    const references =
      workspace.bulletins.reduce(
        (count, entry) => count + entry.document.blocks.filter(usesItem).length,
        0,
      ) +
      workspace.templates.reduce(
        (count, entry) =>
          count + entry.template.starterBlocks.filter(usesItem).length,
        0,
      );
    setDeleteConfirmation({
      title: "Delete library item?",
      message: `Do you want to send ${item.title}, version ${item.version}, to Trash? You can restore it later.${references ? ` It is currently referenced ${references} time${references === 1 ? "" : "s"}; existing references remain unchanged.` : ""}`,
      confirmLabel: "Delete item",
      action: async () =>
        onSave({
          ...(workspace.library ?? {
            schemaVersion: 1,
            name: "Church Library",
          }),
          items: items.filter(
            (entry) => entry.id !== item.id || entry.version !== item.version,
          ),
        }),
    });
  };
  const beginEdit = (item: LibraryItemV1) => {
    setEditing(item);
    setAdding(true);
    setDraft({
      id: item.id,
      title: item.title,
      kind: item.kind,
      text: libraryContentText(item),
      notice: item.license?.notice ?? "",
      asset: item.assets?.[0],
    });
  };
  const closeForm = () => {
    setAdding(false);
    setEditing(undefined);
    setDraft(emptyLibraryDraft());
    setDraftFolderId(undefined);
  };
  const openCatalogRecord = (record: LibraryCatalogRecord) => {
    if (record.targetKind !== "library-item") { onOpenExternal(record); return; }
    const family = catalogRecords.find(item => item.key === record.key)?.value as LibraryFamily | undefined;
    const item = family?.versions[0];
    if (!item) return;
    if (item.kind === "image") { setDraftFolderId(record.folderId); setManagingImages(true); }
    else beginEdit(item);
  };
  const createCatalogRecord = (type: LibraryRecordType, folderId?: string) => {
    if (type === "image") { setDraftFolderId(folderId); setManagingImages(true); return; }
    if (type === "component" || type === "page-template") {
      onOpenExternal({ key: `create:${type}`, targetKind: type, targetId: "", type, title: "", sourceTitle: "", versionCount: 0, folderId, value: undefined }, true);
      return;
    }
    setEditing(undefined);
    setDraft({ ...emptyLibraryDraft(), kind: type });
    setDraftFolderId(folderId);
    setAdding(true);
  };
  const deleteCatalogSelection = async (selectedRecords: LibraryCatalogRecord[], selectedFolderIds: string[]) => {
    const folderIds = new Set(selectedFolderIds);
    for (const id of selectedFolderIds) for (const child of imageFolderDescendantIds(workspace.library, id)) folderIds.add(child);
    const included = catalogRecords.filter(record => selectedRecords.some(item => item.key === record.key) || Boolean(record.folderId && folderIds.has(record.folderId)));
    if (!window.confirm(`Send ${included.length + folderIds.size} selected reusable item${included.length + folderIds.size === 1 ? "" : "s"} to Trash?`)) return;
    const libraryItemIds = new Set(included.filter(record => record.targetKind === "library-item").map(record => record.targetId));
    const componentIds = new Set(included.filter(record => record.targetKind === "component" && !record.builtin).map(record => record.targetId));
    const eventIds = new Set(included.filter(record => record.targetKind === "calendar-event").map(record => record.targetId));
    const pageIds = [...new Set(included.filter(record => record.targetKind === "page-template").map(record => record.targetId))];
    const library = workspace.library ?? { schemaVersion: 1 as const, name: "Church Library", items: [] };
    if (window.bulletin?.trashLibraryRecords) {
      const result = await window.bulletin.trashLibraryRecords(workspace.root, {
        folderIds: [...folderIds],
        records: included.map(record => ({ targetKind: record.targetKind, targetId: record.targetId }))
      }, library);
      await onSave(result.library, true);
      if (result.pageTemplateIds.length) await onDeletePages(result.pageTemplateIds, true);
      return;
    }
    await onSave({
      ...library,
      items: library.items.filter(item => !libraryItemIds.has(item.id)),
      componentDefinitions: (library.componentDefinitions ?? []).filter(item => !componentIds.has(item.type)),
      calendarEvents: (library.calendarEvents ?? []).filter(item => !eventIds.has(item.id)),
      folders: (library.folders ?? []).filter(folder => !folderIds.has(folder.id)),
      catalog: (library.catalog ?? []).filter(entry => !included.some(record => record.targetKind === entry.targetKind && record.targetId === entry.targetId))
    });
    if (pageIds.length) await onDeletePages(pageIds);
  };
  if (!adding && !managingImages && !deleteConfirmation) {
    return <LibraryBrowserDialog
      embedded
      manage
      title={workspace.library?.name ?? "Library"}
      library={workspace.library ?? { schemaVersion: 1, name: "Church Library", items: [] }}
      root={workspace.root}
      records={catalogRecords}
      onLibraryChange={onSave}
      onOpen={openCatalogRecord}
      onCreate={createCatalogRecord}
      onDelete={deleteCatalogSelection}
    />;
  }
  return (
    <div className="library-screen">
      <div className="library-intro">
        <div>
          <div className="eyebrow">Approved content</div>
          <h2>
            {families.length} library item{families.length === 1 ? "" : "s"}
          </h2>
          <p>
            {items.length} saved version{items.length === 1 ? "" : "s"} of
            songs, liturgy, artwork, fonts, and licensing metadata in the synced
            workspace.
          </p>
        </div>
        <div>
          <button className="secondary" onClick={() => setManagingImages(true)}>
            ▦ Manage images
          </button>
          <button
            className="primary"
            onClick={() => {
              if (adding) closeForm();
              else {
                setEditing(undefined);
                setDraft(emptyLibraryDraft());
                setAdding(true);
              }
            }}
          >
            {adding ? "Close form" : "＋ Add library item"}
          </button>
          <div className="library-path">{workspace.root}/library/</div>
        </div>
      </div>
      {adding && (
        <section className="editor-card library-form">
          <h2>{editing ? `Edit ${editing.title}` : "Add library item"}</h2>
          {editing && (
            <p className="helper">
              Saving creates version{" "}
              {Math.max(
                ...items
                  .filter((item) => item.id === editing.id)
                  .map((item) => item.version),
              ) + 1}
              ; existing bulletins pinned to version {editing.version} will not
              change.
            </p>
          )}
          <div className="field-row">
            <label>
              Title
              <input
                value={draft.title}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    title: e.target.value,
                    id:
                      draft.id ||
                      e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                  })
                }
              />
            </label>
            <label>
              Stable ID
              <input
                disabled={Boolean(editing)}
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </label>
          </div>
          <label>
            Kind
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  kind: e.target.value as LibraryItemV1["kind"],
                })
              }
            >
              <option value="song">Song</option>
              <option value="liturgy">Liturgy</option>
              <option value="church-info">Church information</option>
              <option value="font">Font</option>
            </select>
          </label>
          {draft.kind !== "font" && <label>
            Structured text
            <textarea
              rows={6}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="Separate paragraphs or verses with a blank line"
            />
          </label>}
          <label>
            Copyright or license notice
            <textarea
              rows={3}
              value={draft.notice}
              onChange={(e) => setDraft({ ...draft, notice: e.target.value })}
            />
          </label>
          <div className="builder-actions">
            <button
              className="secondary"
              disabled={!draft.id}
              onClick={chooseAsset}
            >
              {draft.asset
                ? `Replace ${draft.asset.alt ?? (draft.kind === "font" ? "font file" : "image or PDF")}`
                : draft.kind === "font" ? "Attach font file" : "Attach image or PDF"}
            </button>
            <button className="secondary" onClick={closeForm}>
              Cancel
            </button>
            <button className="primary" onClick={addItem}>
              {editing ? "Save new version" : "Save item"}
            </button>
          </div>
        </section>
      )}
      {families.length === 0 ? (
        <div className="empty-state">
          <span>▤</span>
          <h2>Your shared library is ready</h2>
          <p>
            Add the first reusable item above. Weekly editors will immediately
            offer songs and liturgy.
          </p>
        </div>
      ) : (
        Object.entries(groups).filter(([kind]) => kind !== "image").map(([kind, entries]) => (
          <section className="library-group" key={kind}>
            <h3>{kind}</h3>
            {entries?.map((family) => {
              const item = selectedItem(family);
              return (
                <article key={family.id}>
                  <div>
                    <b>{item.title}</b>
                    <small>
                      {item.id} · {family.versions.length} version
                      {family.versions.length === 1 ? "" : "s"}
                    </small>
                  </div>
                  <div className="library-item-actions">
                    <select
                      className="inline-version-select"
                      aria-label={`Version for ${family.id}`}
                      value={item.version}
                      onChange={(event) =>
                        setSelectedVersions((current) => ({
                          ...current,
                          [family.id]: Number(event.target.value),
                        }))
                      }
                    >
                      {family.versions.map((version) => (
                        <option value={version.version} key={version.version}>
                          v{version.version}
                          {version.title !== family.versions[0].title
                            ? ` · ${version.title}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    <span>{item.license ? "Licensed" : "No notice"}</span>
                    <button
                      className="text-button"
                      onClick={() => beginEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => requestDelete(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ))
      )}
      {deleteConfirmation && (
        <ConfirmDialog
          confirmation={deleteConfirmation}
          onCancel={() => setDeleteConfirmation(undefined)}
          onConfirm={async () => {
            const action = deleteConfirmation.action;
            setDeleteConfirmation(undefined);
            await action();
          }}
        />
      )}
      {managingImages && (
        <ImageAssetDialog
          library={workspace.library}
          root={workspace.root}
          targetFolder="assets/library/images"
          manageOnly
          initialFolderId={draftFolderId}
          onLibraryChange={onSave}
          onError={onError}
          onClose={() => { setManagingImages(false); setDraftFolderId(undefined); }}
        />
      )}
    </div>
  );
}

function ArchiveView({
  records,
  onRestore,
  onDelete,
}: {
  records: ArchivedWorkspaceRecord[];
  onRestore(record: ArchivedWorkspaceRecord): Promise<void>;
  onDelete(record: ArchivedWorkspaceRecord): Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<ArchivedWorkspaceRecord>();
  return (
    <div className="library-screen">
      <div className="library-intro">
        <div>
          <div className="eyebrow">Recoverable shared records</div>
          <h2>
            {records.length} item{records.length === 1 ? "" : "s"} in Trash
          </h2>
          <p>
            Items in Trash remain in SharePoint and can be restored on every
            connected PC.
          </p>
        </div>
      </div>
      {!records.length ? (
        <div className="empty-state">
          <span>⌫</span>
          <h2>Trash is empty</h2>
          <p>
            Deleted bulletins, templates, reusable pages, songs, calendar
            events, and components will appear here.
          </p>
        </div>
      ) : (
        <section className="library-group">
          <h3>Items in Trash</h3>
          {records.map((record) => (
            <article key={record.id}>
              <div>
                <b>{record.label}</b>
                <small>
                  {record.kind} · {new Date(record.archivedAt).toLocaleString()}
                </small>
              </div>
              <div className="library-item-actions">
                <button
                  className="text-button"
                  onClick={() => void onRestore(record)}
                >
                  Restore
                </button>
                <button
                  className="danger-text"
                  onClick={() => setConfirmation(record)}
                >
                  Delete permanently
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {confirmation && (
        <ConfirmDialog
          confirmation={{
            title: "Permanently delete item from Trash?",
            message: `“${confirmation.label}” content will be removed. A small synchronized tombstone will remain to prevent an offline copy from restoring it.`,
            confirmLabel: "Delete permanently",
            action: () => onDelete(confirmation),
          }}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={async () => {
            const record = confirmation;
            setConfirmation(undefined);
            await onDelete(record);
          }}
        />
      )}
    </div>
  );
}

function SyncCenter({
  conflicts,
  onClose,
  onKeep,
}: {
  conflicts: WorkspaceConflict[];
  onClose(): void;
  onKeep(conflict: WorkspaceConflict, keepPath: string): Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="bulletin-picker-modal sync-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-center-title"
      >
        <header>
          <div>
            <div className="eyebrow">SharePoint synchronization</div>
            <h2 id="sync-center-title">Resolve shared copies</h2>
            <p>No copy is removed until you choose the one to retain.</p>
          </div>
          <button aria-label="Close synchronization center" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="bulletin-picker-list">
          {conflicts.map((conflict) => (
            <article key={conflict.id}>
              <div>
                <b>{conflict.recordId}</b>
                <small>{conflict.kind}</small>
                <p>{conflict.message}</p>
              </div>
              <div>
                {conflict.paths.map((copy) => (
                  <button
                    disabled={saving}
                    key={copy}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await onKeep(conflict, copy);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <span>
                      <b>{copy}</b>
                      <small>
                        Keep this synchronized copy and move the others to Trash
                      </small>
                    </span>
                    <strong>Keep</strong>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function BulletinConflictDialog({
  conflict,
  onDefer,
  onUseShared,
  onKeepCopy,
  onReplaceShared,
}: {
  conflict: BulletinConflictState;
  onDefer(): void;
  onUseShared(): Promise<void>;
  onKeepCopy(): void;
  onReplaceShared(): Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const act = async (action: () => void | Promise<void>) => {
    setSaving(true);
    try {
      await action();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="confirmation-modal sync-conflict-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulletin-conflict-title"
      >
        <div className="eyebrow">Concurrent bulletin edit</div>
        <h2 id="bulletin-conflict-title">
          This bulletin changed on another PC
        </h2>
        <p>{conflict.message}</p>
        <p>
          Your unsaved version remains in this window until you choose what to
          do.
        </p>
        <div className="conflict-actions">
          <button className="secondary" disabled={saving} onClick={onDefer}>
            Decide later
          </button>
          <button
            className="secondary"
            disabled={saving}
            onClick={() => void act(onUseShared)}
          >
            Use shared version
          </button>
          <button className="secondary" disabled={saving} onClick={onKeepCopy}>
            Keep mine as a copy
          </button>
          <button
            className="danger"
            disabled={saving}
            onClick={() => void act(onReplaceShared)}
          >
            Replace shared version
          </button>
        </div>
      </section>
    </div>
  );
}

function PrintApp() {
  const [job, setJob] = useState<{
    root: string;
    document: BulletinDocumentV1;
  }>();
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void window.bulletin?.getPrintJob().then((value) => {
      const next = value as typeof job;
      if (!next) return;
      setJob(next);
      return window.bulletin!.openWorkspace(next.root).then(setWorkspace);
    });
  }, []);
  if (!job || !workspace) return <div>Preparing print layout…</div>;
  const template =
    workspace.templates.find(
      (item) =>
        item.template.id === job.document.template.id &&
        item.template.version === job.document.template.version,
    )?.template ?? defaultTemplate;
  const browser = window.bulletin?.platform === "browser";
  const hasPdfCanvas = flattenBlocks(job.document.blocks).some(
    (block) =>
      block.type === "canvas" &&
      block.scene.background?.asset?.mediaType === "application/pdf",
  );
  return (
    <LibraryFontProvider root={job.root} library={workspace.library}><div
      className={`print-screen ${browser ? "browser-print" : "electron-print"}`}
    >
      {browser && (
        <header className="print-controls">
          <div>
            <b>{ready ? "Print preview ready" : "Preparing pages…"}</b>
            <span>
              {hasPdfCanvas
                ? "Browser printing rasterizes PDF cover backgrounds; desktop export retains the original PDF."
                : "Choose “Save to PDF” in your browser’s print dialog."}
            </span>
          </div>
          <div className="print-actions">
            <button
              className="secondary"
              onClick={() => {
                if (history.length > 1) history.back();
                else window.close();
              }}
            >
              Back to editor
            </button>
            <button
              className="primary"
              disabled={!ready}
              onClick={() => window.print()}
            >
              Print / Save as PDF
            </button>
          </div>
        </header>
      )}
      <DocumentView
        document={job.document}
        template={template}
        library={workspace.library}
        root={job.root}
        print
        onReady={() => {
          if (browser) setReady(true);
          else window.bulletin?.printReady();
        }}
      />
    </div></LibraryFontProvider>
  );
}
