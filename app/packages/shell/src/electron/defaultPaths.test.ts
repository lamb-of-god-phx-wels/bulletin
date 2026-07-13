import { describe, expect, it } from "vitest";
import {
  defaultM4AppSettingsPath,
  defaultM4WorkspaceRoot,
  defaultM4WorkspaceSelectionPath,
} from "./defaultPaths.js";

describe("M4 platform default paths", () => {
  it("uses the required Linux XDG data/config roots with home fallbacks", () => {
    const input = {
      platform: "linux" as const,
      home: "/home/person",
      applicationData: "/unused",
      environment: {
        XDG_DATA_HOME: "/data/person",
        XDG_CONFIG_HOME: "/config/person",
      },
    };
    expect(defaultM4WorkspaceRoot(input)).toBe("/data/person/church-bulletin-builder");
    expect(defaultM4AppSettingsPath(input)).toBe("/config/person/church-bulletin-builder/settings.json");
    expect(defaultM4WorkspaceSelectionPath(input)).toBe("/config/person/church-bulletin-builder/workspace-selection.json");
    expect(defaultM4WorkspaceRoot({ ...input, environment: {} }))
      .toBe("/home/person/.local/share/church-bulletin-builder");
    expect(defaultM4AppSettingsPath({ ...input, environment: {} }))
      .toBe("/home/person/.config/church-bulletin-builder/settings.json");
    expect(defaultM4WorkspaceSelectionPath({ ...input, environment: {} }))
      .toBe("/home/person/.config/church-bulletin-builder/workspace-selection.json");
  });

  it("separates Windows local workspace data from roaming app settings", () => {
    const input = {
      platform: "win32" as const,
      home: "C:\\Users\\Person",
      applicationData: "C:\\Users\\Person\\AppData\\Roaming",
      environment: { LOCALAPPDATA: "C:\\Users\\Person\\AppData\\Local" },
    };
    // path.resolve follows the host platform in unit tests, so use POSIX-like
    // absolute fixtures while preserving the Windows selection branch.
    const portable = {
      ...input,
      home: "/users/person",
      applicationData: "/users/person/appdata/roaming",
      environment: { LOCALAPPDATA: "/users/person/appdata/local" },
    };
    expect(defaultM4WorkspaceRoot(portable)).toBe("/users/person/appdata/local/Church Bulletin Builder");
    expect(defaultM4AppSettingsPath(portable)).toBe("/users/person/appdata/roaming/Church Bulletin Builder/app-settings.json");
    expect(defaultM4WorkspaceSelectionPath(portable))
      .toBe("/users/person/appdata/roaming/Church Bulletin Builder/workspace-selection.json");
  });

  it("ignores relative environment overrides", () => {
    const input = {
      platform: "linux" as const,
      home: "/home/person",
      applicationData: "/unused",
      environment: { XDG_DATA_HOME: "relative/data", XDG_CONFIG_HOME: "relative/config" },
    };
    expect(defaultM4WorkspaceRoot(input)).toBe("/home/person/.local/share/church-bulletin-builder");
    expect(defaultM4AppSettingsPath(input)).toBe("/home/person/.config/church-bulletin-builder/settings.json");
  });
});
