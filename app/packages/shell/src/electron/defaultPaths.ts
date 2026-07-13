import { isAbsolute, join, resolve } from "node:path";

export interface M4PlatformPathInput {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Electron app.getPath("appData"), used for Windows roaming settings only. */
  readonly applicationData: string;
}

function absoluteEnvironmentPath(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 && isAbsolute(value) ? resolve(value) : undefined;
}

export function defaultM4WorkspaceRoot(input: M4PlatformPathInput): string {
  if (input.platform === "win32") {
    const local = absoluteEnvironmentPath(input.environment["LOCALAPPDATA"]);
    return join(local ?? join(resolve(input.home), "AppData", "Local"), "Church Bulletin Builder");
  }
  const data = absoluteEnvironmentPath(input.environment["XDG_DATA_HOME"]);
  return join(data ?? join(resolve(input.home), ".local", "share"), "church-bulletin-builder");
}

export function defaultM4AppSettingsPath(input: M4PlatformPathInput): string {
  if (input.platform === "win32") {
    return join(resolve(input.applicationData), "Church Bulletin Builder", "app-settings.json");
  }
  const config = absoluteEnvironmentPath(input.environment["XDG_CONFIG_HOME"]);
  return join(config ?? join(resolve(input.home), ".config"), "church-bulletin-builder", "settings.json");
}

/** Host-only pointer; its absolute path is never exposed through renderer settings or IPC. */
export function defaultM4WorkspaceSelectionPath(input: M4PlatformPathInput): string {
  if (input.platform === "win32") {
    return join(resolve(input.applicationData), "Church Bulletin Builder", "workspace-selection.json");
  }
  const config = absoluteEnvironmentPath(input.environment["XDG_CONFIG_HOME"]);
  return join(config ?? join(resolve(input.home), ".config"), "church-bulletin-builder", "workspace-selection.json");
}
