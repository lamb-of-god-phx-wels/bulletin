import { describe, expect, it } from "vitest";
import {
  ApplicationShell,
  DocumentWorkspace,
  EditorStore,
  EditorWorkspace,
  PdfPreview,
  SettingsPanel,
  TemplateAuthoringPanel,
  UI_PACKAGE_NAME,
  assertEditorDocumentValid,
} from "./index.js";

describe("@cbb/ui package", () => {
  it("exports the package name constant", () => {
    expect(UI_PACKAGE_NAME).toBe("@cbb/ui");
  });

  it("exports the renderer-owned editor store", () => {
    expect(EditorStore.name).toBe("EditorStore");
  });

  it("exposes the complete M4 application surface from the package root", () => {
    expect([
      ApplicationShell,
      DocumentWorkspace,
      EditorWorkspace,
      SettingsPanel,
      TemplateAuthoringPanel,
      assertEditorDocumentValid,
    ].every((entry) => typeof entry === "function")).toBe(true);
    expect(PdfPreview).toBeTruthy();
  });
});
