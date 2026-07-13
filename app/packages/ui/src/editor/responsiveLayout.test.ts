/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "packages/ui/src/app/app.css"), "utf8");
const editorCss = readFileSync(resolve(process.cwd(), "packages/ui/src/editor/editor.css"), "utf8");
const previewCss = readFileSync(resolve(process.cwd(), "packages/ui/src/preview/preview.css"), "utf8");

describe("compact and 200% editor layout contract", () => {
  it("does not impose a viewport-clipping minimum height", () => {
    expect(editorCss).not.toMatch(/min-height:\s*30rem/u);
    expect(editorCss).toMatch(/\.cbb-editor-workspace\s*\{[^}]*min-height:\s*0;/su);
    expect(appCss).toMatch(/\.cbb-document-workbench\s*\{[^}]*min-height:\s*0;/su);
  });

  it("keeps short-viewport commands inside independently scrollable regions", () => {
    expect(editorCss).toMatch(/@media \(max-width: 56\.25rem\), \(max-height: 30rem\)[\s\S]*?\.cbb-editor-toolbar\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(editorCss).toMatch(/\.cbb-editor-inspector\s*\{[^}]*overflow:\s*auto;/su);
    expect(editorCss).toMatch(/@media \(max-height: 20rem\)[\s\S]*?\.cbb-inspector-scroll\s*\{\s*overflow:\s*visible;/u);
    expect(appCss).toMatch(/@media \(max-height: 32rem\)[\s\S]*?\.cbb-document-header\s*\{[^}]*overflow-y:\s*auto;/u);
  });

  it("contains horizontal overflow at the application boundary while editor surfaces scroll", () => {
    expect(appCss).toMatch(/html,\s*body,\s*#cbb-root\s*\{[^}]*overflow:\s*hidden;/su);
    expect(editorCss).toMatch(/\.cbb-editor-surface\s*\{[^}]*overflow:\s*auto;/su);
    expect(editorCss).toMatch(/\.cbb-toolbar-group\s*\{[^}]*max-width:\s*100%;[^}]*flex-wrap:\s*wrap;/su);
  });

  it("wraps every PDF command into the preview pane instead of clipping the zoom control", () => {
    expect(previewCss).toMatch(/\.cbb-pdf-preview__toolbar\s*\{[^}]*flex-wrap:\s*wrap;/su);
    expect(previewCss).not.toMatch(/\.cbb-pdf-preview__toolbar\s*\{[^}]*overflow-x:\s*auto;/su);
  });
});
