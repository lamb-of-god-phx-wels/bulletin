import { describe, expect, it, vi } from "vitest";
import { makeSequentialIdPort } from "@cbb/core";
import type { RendererSaveOutcome } from "../bridge/index.js";
import { createBulletinFromStarter } from "./documentFactory.js";
import { SerializedDocumentAutosave } from "./serializedAutosave.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("SerializedDocumentAutosave", () => {
  it("marks dirty immediately, serializes saves, and advances the base revision", async () => {
    const first = deferred<RendererSaveOutcome>();
    const second = deferred<RendererSaveOutcome>();
    const saveDocument = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const setDocumentSaveState = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];
    const saver = new SerializedDocumentAutosave({
      bridge: { saveDocument, setDocumentSaveState },
      localResourceId: "10000000-0000-4000-8000-000000000001",
      resourceKind: "bulletin",
      baseRevisionToken: `sha256:${"1".repeat(64)}`,
      onStateChange: (state) => states.push(state.status),
    });
    const document = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(1),
    });
    const saveOne = saver.enqueue(document);
    const saveTwo = saver.enqueue({ ...document, name: "Second edit" });

    expect(states.slice(0, 2)).toEqual(["dirty", "dirty"]);
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(saveDocument.mock.calls[0]?.[0].baseRevisionToken).toBe(`sha256:${"1".repeat(64)}`);
    first.resolve({ status: "saved", revisionToken: `sha256:${"2".repeat(64)}` });
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(2));
    expect(saveDocument.mock.calls[1]?.[0]).toMatchObject({
      displayName: "Second edit",
      baseRevisionToken: `sha256:${"2".repeat(64)}`,
    });
    second.resolve({ status: "saved", revisionToken: `sha256:${"3".repeat(64)}` });

    await expect(saveOne).resolves.toMatchObject({ status: "saved" });
    await expect(saveTwo).resolves.toMatchObject({ status: "saved" });
    await saver.flush();
    expect(states.at(-1)).toBe("clean");
    expect(setDocumentSaveState).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
      "clean",
    );
  });

  it("reports a structured save failure without dropping a later queued save", async () => {
    const saveDocument = vi.fn()
      .mockResolvedValueOnce({ status: "failed", message: "Disk is busy" })
      .mockResolvedValueOnce({ status: "saved", revisionToken: `sha256:${"4".repeat(64)}` });
    const states: string[] = [];
    const saver = new SerializedDocumentAutosave({
      bridge: { saveDocument },
      localResourceId: "10000000-0000-4000-8000-000000000002",
      resourceKind: "bulletin",
      baseRevisionToken: `sha256:${"1".repeat(64)}`,
      onStateChange: (state) => states.push(state.status),
    });
    const document = createBulletinFromStarter({
      starterId: "announcements",
      idPort: makeSequentialIdPort(2),
    });
    void saver.enqueue(document);
    void saver.enqueue({ ...document, name: "Retry content" });
    await saver.flush();

    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(states).toContain("saveFailed");
    expect(states.at(-1)).toBe("clean");
  });

  it("rejects a final flush when the latest save did not reach durable storage", async () => {
    const setDocumentSaveState = vi.fn().mockResolvedValue(undefined);
    const saver = new SerializedDocumentAutosave({
      bridge: {
        saveDocument: vi.fn().mockResolvedValue({
          status: "conflicted",
          message: "The saved bulletin changed elsewhere.",
        }),
        setDocumentSaveState,
      },
      localResourceId: "10000000-0000-4000-8000-000000000003",
      resourceKind: "bulletin",
      baseRevisionToken: `sha256:${"1".repeat(64)}`,
    });
    const document = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(3),
    });

    await expect(saver.enqueue(document)).resolves.toMatchObject({ status: "conflicted" });
    await expect(saver.flush()).rejects.toThrow("The saved bulletin changed elsewhere.");
    expect(setDocumentSaveState).toHaveBeenLastCalledWith(
      "10000000-0000-4000-8000-000000000003",
      "saveFailed",
    );
  });

  it("allows a later successful full-document save to supersede an earlier failure", async () => {
    const saveDocument = vi.fn()
      .mockResolvedValueOnce({ status: "failed", message: "Disk is busy" })
      .mockResolvedValueOnce({ status: "saved", revisionToken: `sha256:${"5".repeat(64)}` });
    const saver = new SerializedDocumentAutosave({
      bridge: { saveDocument },
      localResourceId: "10000000-0000-4000-8000-000000000004",
      resourceKind: "bulletin",
      baseRevisionToken: `sha256:${"1".repeat(64)}`,
    });
    const document = createBulletinFromStarter({
      starterId: "announcements",
      idPort: makeSequentialIdPort(4),
    });

    await expect(saver.enqueue(document)).resolves.toMatchObject({ status: "failed" });
    await expect(saver.flush()).rejects.toThrow("Disk is busy");
    await expect(saver.enqueue({ ...document, name: "Recovered edit" })).resolves.toMatchObject({
      status: "saved",
    });
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(saveDocument.mock.calls[1]?.[0]).toMatchObject({
      displayName: "Recovered edit",
      baseRevisionToken: `sha256:${"1".repeat(64)}`,
    });
  });
});
