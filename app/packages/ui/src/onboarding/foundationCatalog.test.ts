import { describe, expect, it } from "vitest";
import { resolveDocument, validateDocumentSemantics } from "@cbb/core";
import { TASK_LANGUAGE, NORMAL_UI_FORBIDDEN_TERMS } from "../language/index.js";
import { HELP_ARTICLES, searchHelp } from "../help/index.js";
import { STARTER_CATALOG } from "./starters.js";
import { assertEditorDocumentValid } from "../store/documentValidation.js";

function pointerValue(root: unknown, pointer: string): unknown {
  let current = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

describe("M4 foundation catalogs", () => {
  it("provides four generic, usable, semantically valid starter templates", () => {
    expect(STARTER_CATALOG.map((starter) => starter.id)).toEqual([
      "simple-service",
      "folded-letter",
      "announcements",
      "blank-accessible",
    ]);
    expect(new Set(STARTER_CATALOG.map((starter) => starter.document.name)).size).toBe(4);

    for (const starter of STARTER_CATALOG) {
      expect(starter.document.kind).toBe("template");
      expect(starter.document.page.typstWidth).toMatch(/(?:in|mm)$/u);
      expect(starter.document.page.typstHeight).toMatch(/(?:in|mm)$/u);
      expect(starter.document.elements.some((element) => element.type === "rightsAttribution")).toBe(true);
      expect(() => assertEditorDocumentValid(starter.document)).not.toThrow();
      expect(validateDocumentSemantics(starter.document)).toEqual({ valid: true, findings: [] });
      expect(resolveDocument(starter.document, { verifyDefinitionHashes: false }).tree.totalNodeCount).toBeGreaterThan(0);
      for (const element of starter.document.elements) {
        if (element.type === "customInstance") continue;
        for (const binding of element.bindings ?? []) {
          expect(pointerValue(element, binding.target)).toBeUndefined();
          expect(binding.fallback).toBeDefined();
        }
      }
      const serialized = JSON.stringify(starter.document).toLocaleLowerCase();
      expect(serialized).not.toContain("wels");
      expect(serialized).not.toContain("lutheran");
      expect(serialized).not.toContain("congregation address");
    }
  });

  it("keeps normal task language stable and free from internal implementation terms", () => {
    expect(TASK_LANGUAGE.printReadyPdf).toBe("Print-ready PDF");
    expect(TASK_LANGUAGE.savedSection).toBe("Saved section");
    expect(TASK_LANGUAGE.makeIndependent).toBe("Make independent");
    const normalText = Object.values(TASK_LANGUAGE).join(" ").toLocaleLowerCase();
    for (const forbidden of NORMAL_UI_FORBIDDEN_TERMS) {
      expect(normalText).not.toContain(forbidden.toLocaleLowerCase());
    }
  });

  it("ships the required offline help topics and tokenized local search", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(10);
    expect(searchHelp("page size margins").map((article) => article.id)).toContain("page-layout");
    expect(searchHelp("Saved Section reuse").map((article) => article.id)).toContain("saved-sections");
    expect(searchHelp("image description").map((article) => article.id)).toContain("image-description");
    expect(searchHelp("not-a-real-help-topic")).toEqual([]);
    const helpText = JSON.stringify(HELP_ARTICLES);
    expect(helpText).not.toMatch(/Backup or Volunteer handoff|Booklet-print PDF|final PDF|print-ready PDF/u);
    expect(HELP_ARTICLES.map((article) => article.id)).not.toEqual(expect.arrayContaining([
      "backup-handoff",
      "review-export",
      "booklet-test",
    ]));
  });
});
