import { describe, expect, it } from "vitest";
import type { CbbDocument } from "@cbb/core";
import {
  DocumentPatchError,
  applyDocumentPatches,
  documentValueAt,
  documentValuesEqual,
  immutableDocument,
} from "./patches.js";
import { bulletin, textElement } from "./testFixtures.js";

describe("document patches", () => {
  it("applies nested patches immutably with structural sharing", () => {
    const source = bulletin();
    const immutable = immutableDocument(source);
    const result = applyDocumentPatches(immutable, [
      {
        op: "replace",
        path: "/elements/0/data/content/text",
        value: "Grace and peace",
      },
    ]);

    expect(documentValueAt(result.document, "/elements/0/data/content/text")).toBe(
      "Grace and peace",
    );
    expect(documentValueAt(immutable, "/elements/0/data/content/text")).toBe(
      "Welcome",
    );
    expect(result.document.page).toBe(immutable.page);
    expect(result.document.elements[1]).toBe(immutable.elements[1]);
    expect(Object.isFrozen(result.document)).toBe(true);
    expect(Object.isFrozen(result.document.elements)).toBe(true);
  });

  it("does not freeze or retain caller-owned input and patch values", () => {
    const source = bulletin();
    const value = { title: "Original" };
    const result = applyDocumentPatches(source, [
      { op: "add", path: "/orphanedFieldValues", value },
    ]);

    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.page)).toBe(false);
    expect(Object.isFrozen(value)).toBe(false);
    value.title = "Changed outside";
    expect(documentValueAt(result.document, "/orphanedFieldValues/title")).toBe(
      "Original",
    );
  });

  it("derives inverse patches in reverse transaction order", () => {
    const source = bulletin();
    const applied = applyDocumentPatches(source, [
      { op: "replace", path: "/name", value: "First" },
      { op: "replace", path: "/name", value: "Second" },
      { op: "add", path: "/metadata", value: { title: "Printed title" } },
    ]);

    expect(applied.document.name).toBe("Second");
    expect(applied.inversePatches).toEqual([
      { op: "remove", path: "/metadata" },
      { op: "replace", path: "/name", value: "First" },
      { op: "replace", path: "/name", value: "Sunday Bulletin" },
    ]);

    const undone = applyDocumentPatches(applied.document, applied.inversePatches);
    expect(undone.document).toEqual(source);
    expect(undone.inversePatches).toEqual(applied.patches);
  });

  it("normalizes array append inverses to a stable numeric path", () => {
    const source = bulletin({ elements: [textElement("heading")] });
    const inserted = textElement("announcement");
    const result = applyDocumentPatches(source, [
      { op: "add", path: "/elements/-", value: inserted },
    ]);

    expect(result.document.elements.map((element) => element.id)).toEqual([
      "heading",
      "announcement",
    ]);
    expect(result.inversePatches).toEqual([
      { op: "remove", path: "/elements/1" },
    ]);
  });

  it("restores an object property replaced by add", () => {
    const source = bulletin();
    const result = applyDocumentPatches(source, [
      { op: "add", path: "/name", value: "Replacement" },
    ]);
    expect(result.inversePatches).toEqual([
      { op: "replace", path: "/name", value: "Sunday Bulletin" },
    ]);
  });

  it("supports escaped JSON Pointer property names", () => {
    const source = bulletin({
      orphanedFieldValues: { "a/b~c": { value: 1 } },
    });
    const result = applyDocumentPatches(source, [
      {
        op: "replace",
        path: "/orphanedFieldValues/a~1b~0c/value",
        value: 2,
      },
    ]);
    expect(
      documentValueAt(result.document, "/orphanedFieldValues/a~1b~0c/value"),
    ).toBe(2);
  });

  it("supports replacing the document root but never removing it", () => {
    const replacement = bulletin({ name: "Replacement" });
    const result = applyDocumentPatches(bulletin(), [
      { op: "replace", path: "", value: replacement },
    ]);
    expect(result.document.name).toBe("Replacement");
    expect(() =>
      applyDocumentPatches(bulletin(), [{ op: "remove", path: "" }]),
    ).toThrow("document root cannot be removed");
  });

  it.each([
    [{ op: "replace", path: "name", value: "bad" }],
    [{ op: "replace", path: "/elements/01/name", value: "bad" }],
    [{ op: "replace", path: "/elements/20/name", value: "bad" }],
    [{ op: "replace", path: "/missing/name", value: "bad" }],
    [{ op: "replace", path: "/elements/~2/name", value: "bad" }],
    [{ op: "add", path: "/__proto__/polluted", value: true }],
  ] as const)("rejects malformed or unsafe paths %#", (patch) => {
    expect(() =>
      applyDocumentPatches(
        bulletin(),
        [patch] as Parameters<typeof applyDocumentPatches>[1],
      ),
    ).toThrow(DocumentPatchError);
  });

  it("rejects non-JSON values and cycles", () => {
    expect(() =>
      applyDocumentPatches(bulletin(), [
        { op: "add", path: "/metadata", value: { date: new Date() } },
      ]),
    ).toThrow("plain objects");

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() =>
      applyDocumentPatches(bulletin(), [
        { op: "add", path: "/metadata", value: cyclic },
      ]),
    ).toThrow("cycles");

    const sparse = Array<unknown>(1);
    expect(() =>
      applyDocumentPatches(bulletin(), [
        { op: "add", path: "/orphanedFieldValues", value: { sparse } },
      ]),
    ).toThrow("sparse arrays");
  });

  it("closes the runtime patch operation set", () => {
    const unsupported = {
      op: "move",
      from: "/elements/0",
      path: "/elements/1",
    } as unknown as Parameters<typeof applyDocumentPatches>[1][number];
    expect(() => applyDocumentPatches(bulletin(), [unsupported])).toThrow(
      "Unsupported document patch operation",
    );
  });

  it("rejects a transaction that would corrupt the required root shape", () => {
    const source = bulletin();
    expect(() =>
      applyDocumentPatches(source, [{ op: "remove", path: "/page" }]),
    ).toThrow("invalid document root");
    expect(source.page).toEqual({ typstWidth: "7in", typstHeight: "8.5in" });
  });

  it("validates semantics once at the final transaction boundary", () => {
    const source = bulletin();
    expect(() =>
      applyDocumentPatches(source, [
        { op: "replace", path: "/elements/1/id", value: "heading" },
      ]),
    ).toThrow(/CBB-DOC-0100/u);

    const replacedPage = applyDocumentPatches(source, [
      { op: "remove", path: "/page" },
      {
        op: "add",
        path: "/page",
        value: { typstWidth: "8.5in", typstHeight: "11in" },
      },
    ]);
    expect(replacedPage.document.page).toEqual({
      typstWidth: "8.5in",
      typstHeight: "11in",
    });
  });

  it("compares JSON values without key-order sensitivity", () => {
    expect(documentValuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(documentValuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(documentValuesEqual([1, 2], [2, 1])).toBe(false);
    const sparse = Array<unknown>(1);
    expect(documentValuesEqual(sparse, [undefined])).toBe(false);
  });

  it("accepts a typed full-document replacement", () => {
    const replacement: CbbDocument = bulletin({ kind: "template" });
    expect(
      applyDocumentPatches(bulletin(), [
        { op: "replace", path: "", value: replacement },
      ]).document.kind,
    ).toBe("template");
  });
});
