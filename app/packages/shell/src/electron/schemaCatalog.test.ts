import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadM4SchemaCatalog } from "./schemaCatalog.js";

describe("bundled M4 schema catalog", () => {
  it("loads the complete offline catalog before the renderer opens", async () => {
    const catalog = await loadM4SchemaCatalog(resolve(process.cwd(), "schemas/v1"));
    expect(catalog.validateAgainst(
      "https://church-bulletin-builder.local/schema/v1/settings.schema.json",
      { version: 1, kind: "globalSettings", theme: "system" },
    ).valid).toBe(true);
    expect(catalog.validateAgainst(
      "https://church-bulletin-builder.local/schema/v1/document.schema.json",
      { version: 2, kind: "bulletin", name: "Test", page: { typstWidth: "8.5in", typstHeight: "11in" }, elements: [] },
    ).valid).toBe(true);
  });

  it("requires an absolute nonempty catalog directory", async () => {
    await expect(loadM4SchemaCatalog("schemas/v1")).rejects.toThrow(/absolute/);
    await expect(loadM4SchemaCatalog(resolve(process.cwd(), "schemas/does-not-exist"))).rejects.toThrow();
  });
});
