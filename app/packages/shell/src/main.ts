import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { WorkspacePreferencesService, createNodeServicePorts } from "@cbb/services";
import type { M4JsonValue } from "./ipc/contract.js";
import {
  M3ApplicationServiceRoot,
  type M3EditableWorkspace,
  type M3ReadOnlyWorkspace,
} from "./composition.js";
import { NodeM4AuxiliaryHandlers } from "./ipc/nodeAuxiliaryHandlers.js";
import { M4WorkspaceRendererHandlers } from "./ipc/workspaceHandlers.js";
import { NodeM4ManagedImageImporter } from "./ipc/nodeManagedImageImport.js";
import { createM4Window, type M4WindowHandle } from "./electron/windowHost.js";
import { readStableSelectedImage } from "./electron/nodeImageSelection.js";
import { selectM4RendererLocation } from "./electron/windowPolicy.js";
import {
  defaultM4AppSettingsPath,
  defaultM4WorkspaceRoot,
  defaultM4WorkspaceSelectionPath,
} from "./electron/defaultPaths.js";
import { NodeM4WorkspaceSelection } from "./electron/workspaceSelection.js";
import { loadM4SchemaCatalog } from "./electron/schemaCatalog.js";
import { rendererAllowsShutdown } from "./electron/shutdownGuard.js";
import { loadPackagedM3PreviewRuntime } from "./electron/packagedPreviewRuntime.js";
import { M4_PACKAGED_M3_TRUST_FILE_HASH } from "./electron/packagedPreviewTrust.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = resolve(moduleDirectory, "../../..");
const schemaDirectory = resolve(applicationRoot, "schemas/v1");
const productionRenderer = resolve(applicationRoot, "renderer/index.html");
let startupServices: M3ApplicationServiceRoot | undefined;

function platformPaths() {
  return {
    platform: process.platform,
    home: app.getPath("home"),
    environment: process.env,
    applicationData: app.getPath("appData"),
  } as const;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function openDefaultWorkspace(
  services: M3ApplicationServiceRoot,
  workspaceRoot: string,
): Promise<M3EditableWorkspace | M3ReadOnlyWorkspace> {
  const hasRegistry = await exists(resolve(workspaceRoot, "workspace.json"));
  if (!hasRegistry) await mkdir(dirname(workspaceRoot), { recursive: true });
  const result = hasRegistry
    ? await services.openWorkspace(workspaceRoot)
    : await services.createWorkspace({
        root: workspaceRoot,
        displayName: "Your bulletin library",
      });
  if (result.status === "failed") {
    const summary = result.diagnostics[0]?.userSummary;
    throw new Error(summary ?? "Your bulletin library could not be opened for editing.");
  }
  return result.status === "editable" ? result.workspace : result.session;
}

async function start(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.enableSandbox();
  await app.whenReady();
  app.setAppUserModelId("org.church-bulletin-builder.desktop");

  const catalog = await loadM4SchemaCatalog(schemaDirectory);
  const configuredWorkspace = process.env["CBB_WORKSPACE_ROOT"];
  const workspaceSelection = new NodeM4WorkspaceSelection(
    defaultM4WorkspaceSelectionPath(platformPaths()),
  );
  const selectedWorkspace = configuredWorkspace === undefined || configuredWorkspace.length === 0
    ? await workspaceSelection.read()
    : undefined;
  const workspaceRoot = configuredWorkspace !== undefined && configuredWorkspace.length > 0
    ? resolve(configuredWorkspace)
    : selectedWorkspace ?? defaultM4WorkspaceRoot(platformPaths());
  const previewRuntime = await loadPackagedM3PreviewRuntime({
    applicationRoot,
    workspaceRoot,
    appVersion: app.getVersion(),
    catalog,
    ...(M4_PACKAGED_M3_TRUST_FILE_HASH === undefined
      ? {}
      : { expectedTrustFileHash: M4_PACKAGED_M3_TRUST_FILE_HASH }),
  });
  const services = new M3ApplicationServiceRoot({
    catalog,
    appVersion: app.getVersion(),
    ...(previewRuntime?.serviceOptions ?? {}),
  });
  startupServices = services;
  const workspace = await openDefaultWorkspace(services, workspaceRoot);
  const settingsSchemaId = "https://church-bulletin-builder.local/schema/v1/settings.schema.json";
  const validateAppSettings = (value: unknown): M4JsonValue => {
    const result = catalog.validateAgainst(settingsSchemaId, value);
    if (!result.valid || typeof value !== "object" || value === null ||
      (value as { readonly kind?: unknown }).kind !== "globalSettings") {
      throw new Error("Application settings failed schema validation");
    }
    return value as M4JsonValue;
  };
  const auxiliary = new NodeM4AuxiliaryHandlers({
    workspaceRoot,
    appSettingsPath: defaultM4AppSettingsPath(platformPaths()),
    defaultAppSettings: { version: 1, kind: "globalSettings", theme: "system" },
    validateAppSettings,
  });
  const readOnlyPreferences = "documents" in workspace
    ? undefined
    : (() => {
        const preferences = new WorkspacePreferencesService(createNodeServicePorts(), catalog);
        return {
          loadSettings: () => preferences.loadSettings(workspace),
          loadChurchProfile: () => preferences.loadChurchProfile(workspace),
          saveSettings: (value: Parameters<typeof preferences.saveSettings>[0]["value"], baseHash: Parameters<typeof preferences.saveSettings>[0]["baseHash"]) =>
            preferences.saveSettings({ session: workspace, value, baseHash }),
        };
      })();
  let windowHandle: M4WindowHandle | undefined;
  const chooseWorkspaceLocation = async () => {
    if (configuredWorkspace !== undefined && configuredWorkspace.length > 0) {
      return {
        status: "unavailable" as const,
        message: "This launch fixed the bulletin-library location, so it cannot be changed here.",
      };
    }
    try {
      const owner = windowHandle?.window;
      if (owner === undefined || owner.isDestroyed()) {
        return {
          status: "unavailable" as const,
          message: "The folder chooser is unavailable while this window is closing.",
        };
      }
      const choice = await dialog.showOpenDialog(owner, {
        title: "Choose bulletin library location",
        buttonLabel: "Use this location",
        properties: ["openDirectory", "createDirectory"],
      });
      if (choice.canceled || choice.filePaths.length !== 1) return { status: "canceled" as const };
      const chosenRoot = await realpath(choice.filePaths[0]!);
      if (chosenRoot === workspaceRoot) return { status: "canceled" as const };
      if ((await stat(chosenRoot)).isDirectory() === false || (await readdir(chosenRoot)).length > 0) {
        return {
          status: "unavailable" as const,
          message: "Choose an empty folder for the new bulletin library.",
        };
      }
      await workspaceSelection.write(chosenRoot);
      app.relaunch();
      setTimeout(() => app.quit(), 0);
      return { status: "restarting" as const };
    } catch {
      return {
        status: "unavailable" as const,
        message: "That folder could not be used safely. Choose another empty folder.",
      };
    }
  };
  const imageImporter = "documents" in workspace && previewRuntime !== undefined
    ? new NodeM4ManagedImageImporter({
        workspace,
        catalog,
        canonicalizer: previewRuntime.imageCanonicalizer,
        chooseImage: async () => {
          const owner = windowHandle?.window;
          if (owner === undefined || owner.isDestroyed()) {
            throw new Error("The image chooser is unavailable while this window is closing.");
          }
          const choice = await dialog.showOpenDialog(owner, {
            title: "Import image",
            buttonLabel: "Import image",
            properties: ["openFile"],
            filters: [{
              name: "PNG, JPEG, or SVG image",
              extensions: ["png", "jpg", "jpeg", "svg"],
            }],
          });
          if (choice.canceled || choice.filePaths.length !== 1) return { status: "canceled" };
          return {
            status: "selected",
            input: await readStableSelectedImage(choice.filePaths[0]!),
          };
        },
      })
    : undefined;
  const handlers = new M4WorkspaceRendererHandlers({
    workspace,
    catalog,
    auxiliary,
    chooseWorkspaceLocation,
    ...(imageImporter === undefined ? {} : { importImageAsset: () => imageImporter.import() }),
    ...(readOnlyPreferences === undefined ? {} : { readOnlyPreferences }),
  });
  const developmentUrl = process.env["CBB_RENDERER_DEV_URL"];
  const renderer = selectM4RendererLocation({
    isPackaged: app.isPackaged,
    productionIndexPath: productionRenderer,
    developmentUrl,
  });
  let closing = false;
  let closed = false;
  windowHandle = await createM4Window({
    BrowserWindow,
    ipcMain,
    // Sandboxed Electron preloads cannot execute ESM imports. The shell build
    // therefore bundles this entry as one CommonJS file.
    preloadPath: resolve(moduleDirectory, "preload.cjs"),
    renderer,
    handlers,
    ...("documents" in workspace ? {} : { title: "Church Bulletin Builder — Read only" }),
  });

  // A window-manager close request arrives before `window-all-closed`. Keep
  // the editor alive while the M3 lifetime decides whether it is safe to quit.
  windowHandle.window.on("close", (event) => {
    if (closed) return;
    event.preventDefault();
    app.quit();
  });

  app.on("second-instance", () => {
    const window = windowHandle?.window;
    if (window === undefined || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (closed) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    const editorWindow = windowHandle?.window;
    if (editorWindow !== undefined && !editorWindow.isDestroyed()) editorWindow.setEnabled(false);
    const restoreEditor = () => {
      closing = false;
      if (editorWindow === undefined || editorWindow.isDestroyed()) return;
      editorWindow.setEnabled(true);
      editorWindow.focus();
    };
    void (async () => {
      if (!await rendererAllowsShutdown(handlers)) {
        restoreEditor();
        dialog.showErrorBox(
          "Finish saving before closing",
          "One or more bulletins still have unsaved changes. Save them before closing the app.",
        );
        return;
      }
      const outcome = await services.close();
      if (outcome.status === "blocked") {
        restoreEditor();
        dialog.showErrorBox(
          "Finish saving before closing",
          "Church Bulletin Builder is still protecting unsaved work. Return to the bulletin and save before closing.",
        );
        return;
      }
      closed = true;
      startupServices = undefined;
      // Keep IPC/network guards installed until BrowserWindow emits `closed`;
      // its host-owned listener disposes them at that exact boundary.
      app.quit();
    })().catch(() => {
      restoreEditor();
      dialog.showErrorBox(
        "Could not close safely",
        "Church Bulletin Builder could not finish closing your bulletin library. Your files were not discarded.",
      );
    });
  });
}

void start().catch(async (error) => {
  await startupServices?.close().catch(() => undefined);
  startupServices = undefined;
  const detail = error instanceof Error ? error.message : "The desktop application could not start safely.";
  dialog.showErrorBox("Church Bulletin Builder could not start", detail);
  app.quit();
});
