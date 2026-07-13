import { describe, expect, it, vi } from "vitest";
import { createDemoRendererBridge, getRendererBridge } from "./rendererBridge.js";

describe("renderer bridge demo fallback", () => {
  it("is frozen, path-free, and provides an in-memory bulletin vertical slice", async () => {
    const bridge = createDemoRendererBridge();
    expect(Object.isFrozen(bridge)).toBe(true);
    const [summary] = await bridge.listDocuments("bulletin");
    expect(summary).toBeDefined();
    if (summary === undefined) return;
    expect(JSON.stringify(summary)).not.toMatch(/(?:\/home\/|[A-Z]:\\|storagePath)/u);
    const loaded = await bridge.loadDocument(summary.localResourceId);
    expect(loaded.document.kind).toBe("bulletin");
    const saved = await bridge.saveDocument({
      localResourceId: loaded.localResourceId,
      resourceKind: loaded.resourceKind,
      displayName: "Edited practice bulletin",
      document: { ...loaded.document, name: "Edited practice bulletin" },
      baseRevisionToken: loaded.revisionToken,
    });
    expect(saved.status).toBe("saved");
    await expect(bridge.saveDocument({
      localResourceId: loaded.localResourceId,
      resourceKind: loaded.resourceKind,
      displayName: "Stale edit",
      document: loaded.document,
      baseRevisionToken: loaded.revisionToken,
    })).resolves.toMatchObject({ status: "conflicted" });
  });

  it("keeps settings and edit buffers in memory and exposes only the bundled sample PDF", async () => {
    const bridge = createDemoRendererBridge();
    const [summary] = await bridge.listDocuments();
    if (summary === undefined) throw new Error("missing demo bulletin");
    await expect(bridge.writeEditBuffer(summary.localResourceId, "field", "unfinished"))
      .resolves.toMatchObject({ value: "unfinished" });
    await expect(bridge.readEditBuffer(summary.localResourceId, "field"))
      .resolves.toMatchObject({ value: "unfinished" });
    await expect(bridge.writeAppSettings({ version: 1, theme: "dark" }))
      .resolves.toEqual({ version: 1, theme: "dark" });
    await expect(bridge.readPdfBytes(
      summary.localResourceId,
      "20000000-0000-4000-8000-000000000001",
    )).rejects.toThrow(/unavailable in the browser demo/i);

    const admission = await bridge.requestPreview({
      localResourceId: summary.localResourceId,
      requestSequence: 1,
    });
    const state = await bridge.getPreviewState(summary.localResourceId);
    expect(state).toMatchObject({
      status: "current",
      lastSuccessfulBuildId: admission.buildId,
      pageCount: 1,
      navigationMap: { version: 1 },
    });
    const first = await bridge.readPdfBytes(summary.localResourceId, admission.buildId);
    const second = await bridge.readPdfBytes(summary.localResourceId, admission.buildId);
    const pdfSource = new TextDecoder().decode(first);
    expect(pdfSource.slice(0, 8)).toBe("%PDF-1.4");
    expect(first.byteLength).toBeGreaterThan(400);
    expect(second).not.toBe(first);
    const startXref = /startxref\n(?<offset>[0-9]+)\n%%EOF/u.exec(pdfSource)?.groups?.["offset"];
    expect(startXref).toBeDefined();
    expect(pdfSource.slice(Number(startXref))).toMatch(/^xref\n/u);
    const objectOffsets = [...pdfSource.matchAll(/^(?<offset>[0-9]{10}) 00000 n /gmu)];
    expect(objectOffsets).toHaveLength(5);
    objectOffsets.forEach((match, index) => {
      expect(pdfSource.slice(Number(match.groups?.["offset"]))).toMatch(new RegExp(`^${index + 1} 0 obj\\n`, "u"));
    });
  });

  it("keeps a path-free Church Profile behind nullable compare-and-swap revisions", async () => {
    const bridge = createDemoRendererBridge();
    await expect(bridge.readChurchProfile()).resolves.toEqual({ value: null, revisionToken: null });
    const profile = {
      version: 1 as const,
      kind: "churchProfile" as const,
      congregationName: "Lamb of God",
      language: "en-US",
      defaultUnknownRightsPolicy: "review" as const,
    };
    const saved = await bridge.writeChurchProfile(profile, null);
    expect(saved).toMatchObject({ status: "saved", value: profile });
    if (saved.status !== "saved") throw new Error("Church Profile fixture was not saved");
    await expect(bridge.readChurchProfile()).resolves.toEqual({
      value: profile,
      revisionToken: saved.revisionToken,
    });
    await expect(bridge.writeChurchProfile({ ...profile, congregationName: "Changed" }, null))
      .resolves.toMatchObject({ status: "conflicted", currentRevisionToken: saved.revisionToken });
  });

  it("exposes a path-free validated image and returns a fresh byte copy", async () => {
    const bridge = createDemoRendererBridge();
    const [asset] = await bridge.listImageAssets();
    expect(asset).toMatchObject({
      displayName: "Worship cross illustration",
      mediaType: "image/svg+xml",
    });
    expect(JSON.stringify(asset)).not.toMatch(/(?:\/home\/|[A-Z]:\\|storagePath|canonicalPath)/u);
    if (asset === undefined) throw new Error("missing demo image");

    const first = await bridge.readImageAssetBytes(asset.localAssetId, asset.assetRef);
    const second = await bridge.readImageAssetBytes(asset.localAssetId, asset.assetRef);
    expect(new TextDecoder().decode(first)).toContain("<svg");
    expect(first.byteLength).toBe(asset.byteSize);
    expect(second).not.toBe(first);
    first[0] = 0;
    expect(second[0]).not.toBe(0);
    await expect(bridge.readImageAssetBytes(asset.localAssetId, "asset:missing"))
      .rejects.toThrow(/unavailable/u);
  });

  it("fails closed in an Electron renderer when the preload bridge is missing", () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1" },
      churchBulletinBuilder: undefined,
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Electron/37.10.3" });
    try {
      expect(() => getRendererBridge()).toThrow(/secure .* bridge is unavailable/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
