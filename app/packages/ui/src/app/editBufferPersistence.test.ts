import { describe, expect, it } from "vitest";
import type { RendererEditBufferValue } from "../bridge/index.js";
import { inspectorCanonicalValueHash } from "../inspector/index.js";
import {
  INSPECTOR_BUFFER_MANIFEST_KEY,
  InspectorBufferPersistence,
  type EditBufferBridge,
} from "./editBufferPersistence.js";

function memoryBridge(): EditBufferBridge & {
  readonly values: Map<string, RendererEditBufferValue>;
  readonly states: string[];
} {
  const values = new Map<string, RendererEditBufferValue>();
  const states: string[] = [];
  return {
    values,
    states,
    async setEditBufferSaveState(_id, state) { states.push(state); },
    async readEditBuffer(_id, key) {
      return values.get(key) ?? null;
    },
    async writeEditBuffer(_id, key, value) {
      const stored = { value, updatedAt: "2026-07-13T01:00:00.000Z" };
      values.set(key, stored);
      return stored;
    },
    async deleteEditBuffer(_id, key) {
      return values.delete(key);
    },
  };
}

describe("InspectorBufferPersistence", () => {
  it("maintains a durable manifest and restores exact invalid-control metadata", async () => {
    const bridge = memoryBridge();
    const id = "10000000-0000-4000-8000-000000000003";
    const persistence = new InspectorBufferPersistence(bridge, id, "revision-7");
    await persistence.update({
      controlId: "inspector-title-width",
      value: "not a length yet",
      baseDocumentRevision: 7,
      baseResourceRevisionToken: "revision-7",
      baseCanonicalHash: inspectorCanonicalValueHash("1in"),
      status: "invalid",
      error: "Use a physical length.",
    });

    expect(bridge.values.has(INSPECTOR_BUFFER_MANIFEST_KEY)).toBe(true);
    expect(bridge.states).toEqual(["pending", "clean"]);
    expect(bridge.values.size).toBe(2);
    const restored = await new InspectorBufferPersistence(bridge, id, "revision-7").restore();
    expect(restored).toEqual({
      buffers: {
        "inspector-title-width": {
          value: "not a length yet",
          baseDocumentRevision: 7,
          baseResourceRevisionToken: "revision-7",
          baseCanonicalHash: inspectorCanonicalValueHash("1in"),
          status: "invalid",
          error: "Use a physical length.",
        },
      },
    });

    await persistence.update({
      controlId: "inspector-title-width",
      value: "1in",
      baseDocumentRevision: 7,
      baseResourceRevisionToken: "revision-7",
      baseCanonicalHash: inspectorCanonicalValueHash("1in"),
      status: "committed",
    });
    expect(bridge.values.size).toBe(0);
    expect(bridge.states.slice(-2)).toEqual(["pending", "clean"]);
  });

  it("leaves malformed recovery evidence untouched and returns a plain warning", async () => {
    const bridge = memoryBridge();
    bridge.values.set(INSPECTOR_BUFFER_MANIFEST_KEY, {
      value: "{broken",
      updatedAt: "2026-07-13T01:00:00.000Z",
    });
    const restored = await new InspectorBufferPersistence(
      bridge,
      "10000000-0000-4000-8000-000000000004",
    ).restore();
    expect(restored.buffers).toEqual({});
    expect(restored.warning).toMatch(/left untouched/i);
    expect(bridge.values.has(INSPECTOR_BUFFER_MANIFEST_KEY)).toBe(true);
  });

  it("reports a failed host blocker when durable buffer storage fails", async () => {
    const bridge = memoryBridge();
    bridge.writeEditBuffer = async () => { throw new Error("storage failed"); };
    const persistence = new InspectorBufferPersistence(
      bridge,
      "10000000-0000-4000-8000-000000000005",
    );
    await expect(persistence.update({
      controlId: "inspector-title-width",
      value: "unfinished",
      baseDocumentRevision: 2,
      baseResourceRevisionToken: "revision-2",
      baseCanonicalHash: inspectorCanonicalValueHash("original"),
      status: "dirty",
    })).rejects.toThrow("storage failed");
    expect(bridge.states).toEqual(["pending", "failed"]);
    await expect(persistence.flush()).rejects.toThrow(/not yet protected/u);
  });

  it("reconciles a first-value manifest failure before a retry can report clean", async () => {
    const bridge = memoryBridge();
    const originalWrite = bridge.writeEditBuffer.bind(bridge);
    let failManifestOnce = true;
    bridge.writeEditBuffer = async (id, key, value) => {
      if (key === INSPECTOR_BUFFER_MANIFEST_KEY && failManifestOnce) {
        failManifestOnce = false;
        throw new Error("manifest write failed");
      }
      return originalWrite(id, key, value);
    };
    const id = "10000000-0000-4000-8000-000000000008";
    const update = {
      controlId: "inspector-title-width",
      value: "unfinished width",
      baseDocumentRevision: 4,
      baseResourceRevisionToken: "revision-4",
      baseCanonicalHash: inspectorCanonicalValueHash("1in"),
      status: "dirty" as const,
    };
    const persistence = new InspectorBufferPersistence(bridge, id, "revision-4");

    await expect(persistence.update(update)).rejects.toThrow("manifest write failed");
    expect(bridge.values.has(INSPECTOR_BUFFER_MANIFEST_KEY)).toBe(false);
    expect(bridge.values.size).toBe(1);
    expect(bridge.states.at(-1)).toBe("failed");

    await expect(persistence.update(update)).resolves.toBeUndefined();
    expect(bridge.states.at(-1)).toBe("clean");
    const restarted = await new InspectorBufferPersistence(bridge, id, "revision-4").restore();
    expect(restarted.buffers[update.controlId]).toMatchObject({
      value: update.value,
      baseResourceRevisionToken: "revision-4",
      status: "dirty",
    });
  });

  it("restores the durable index after a removal-manifest failure and cleans it on retry", async () => {
    const bridge = memoryBridge();
    const id = "10000000-0000-4000-8000-000000000009";
    const persistence = new InspectorBufferPersistence(bridge, id, "revision-5");
    const dirty = {
      controlId: "inspector-title-width",
      value: "unfinished width",
      baseDocumentRevision: 5,
      baseResourceRevisionToken: "revision-5",
      baseCanonicalHash: inspectorCanonicalValueHash("1in"),
      status: "dirty" as const,
    };
    await persistence.update(dirty);
    const originalDelete = bridge.deleteEditBuffer.bind(bridge);
    let failManifestDeleteOnce = true;
    bridge.deleteEditBuffer = async (resourceId, key) => {
      if (key === INSPECTOR_BUFFER_MANIFEST_KEY && failManifestDeleteOnce) {
        failManifestDeleteOnce = false;
        throw new Error("manifest removal failed");
      }
      return originalDelete(resourceId, key);
    };
    const committed = { ...dirty, value: "1in", status: "committed" as const };

    await expect(persistence.update(committed)).rejects.toThrow("manifest removal failed");
    expect(bridge.values.has(INSPECTOR_BUFFER_MANIFEST_KEY)).toBe(true);
    expect(bridge.values.size).toBe(2);
    expect(bridge.states.at(-1)).toBe("failed");

    await expect(persistence.update(committed)).resolves.toBeUndefined();
    expect(bridge.states.at(-1)).toBe("clean");
    expect(bridge.values.size).toBe(0);
    await expect(new InspectorBufferPersistence(bridge, id, "revision-5").restore())
      .resolves.toEqual({ buffers: {} });
  });

  it("marks recovered text conflicted when the durable bulletin revision changed", async () => {
    const bridge = memoryBridge();
    const id = "10000000-0000-4000-8000-000000000006";
    const writer = new InspectorBufferPersistence(bridge, id, "revision-before");
    await writer.update({
      controlId: "inspector-first-text",
      value: "unfinished text",
      baseDocumentRevision: 3,
      baseResourceRevisionToken: "revision-before",
      baseCanonicalHash: inspectorCanonicalValueHash("saved text"),
      status: "dirty",
    });

    const restored = await new InspectorBufferPersistence(
      bridge,
      id,
      "revision-after",
    ).restore();
    expect(restored.buffers["inspector-first-text"]).toMatchObject({
      value: "unfinished text",
      baseResourceRevisionToken: "revision-before",
      recoveryConflict: "durableRevisionChanged",
    });
  });

  it("treats legacy recovery records without canonical evidence as review-required", async () => {
    const bridge = memoryBridge();
    const id = "10000000-0000-4000-8000-000000000007";
    bridge.values.set(INSPECTOR_BUFFER_MANIFEST_KEY, {
      value: JSON.stringify({
        version: 1,
        kind: "inspectorEditBufferManifest",
        entries: [{ controlId: "inspector-first-text", storageKey: "cbb.inspector.0123456789abcdef" }],
      }),
      updatedAt: "2026-07-13T01:00:00.000Z",
    });
    bridge.values.set("cbb.inspector.0123456789abcdef", {
      value: JSON.stringify({
        version: 1,
        kind: "inspectorEditBuffer",
        controlId: "inspector-first-text",
        value: "legacy draft",
        baseDocumentRevision: 1,
        status: "dirty",
      }),
      updatedAt: "2026-07-13T01:00:00.000Z",
    });

    const restored = await new InspectorBufferPersistence(bridge, id, "current").restore();
    expect(restored.buffers["inspector-first-text"]).toMatchObject({
      recoveryConflict: "evidenceMissing",
    });
  });
});
