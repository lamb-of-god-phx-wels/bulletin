import type { RendererBridge } from "../bridge/index.js";
import type {
  InspectorEditBufferUpdate,
  InspectorRestoredEditBuffer,
} from "../inspector/index.js";

export const INSPECTOR_BUFFER_MANIFEST_KEY = "cbb.inspector.manifest.v1";
const MAX_BUFFER_ENTRIES = 511;
const MAX_BUFFER_VALUE_LENGTH = 65_536;
const MAX_BUFFER_ERROR_LENGTH = 4_096;
const MAX_REVISION_TOKEN_LENGTH = 512;
const STORAGE_KEY_PATTERN = /^cbb\.inspector\.[0-9a-f]{16}(?:\.[0-9]+)?$/u;
const CANONICAL_HASH_PATTERN = /^fnv1a64:[0-9a-f]{16}$/u;

interface ManifestEntry {
  readonly controlId: string;
  readonly storageKey: string;
}

interface InspectorBufferManifest {
  readonly version: 1;
  readonly kind: "inspectorEditBufferManifest";
  readonly entries: readonly ManifestEntry[];
}

interface InspectorBufferRecord {
  readonly version: 1 | 2;
  readonly kind: "inspectorEditBuffer";
  readonly controlId: string;
  readonly value: string;
  readonly baseDocumentRevision: number;
  readonly baseResourceRevisionToken?: string | null;
  readonly baseCanonicalHash?: string;
  readonly status: "dirty" | "invalid";
  readonly error?: string;
}

export interface EditBufferBridge extends Pick<
  RendererBridge,
  "readEditBuffer" | "writeEditBuffer" | "deleteEditBuffer" | "setEditBufferSaveState"
> {}

export interface InspectorBufferRestoreResult {
  readonly buffers: Readonly<Record<string, InspectorRestoredEditBuffer>>;
  readonly warning?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function parseManifest(value: string): InspectorBufferManifest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!record(parsed) || parsed["version"] !== 1 ||
    parsed["kind"] !== "inspectorEditBufferManifest" || !Array.isArray(parsed["entries"]) ||
    parsed["entries"].length > MAX_BUFFER_ENTRIES) return undefined;
  const entries: ManifestEntry[] = [];
  const controls = new Set<string>();
  const storageKeys = new Set<string>();
  for (const candidate of parsed["entries"]) {
    if (!record(candidate) || Object.keys(candidate).sort().join("\0") !== "controlId\0storageKey" ||
      typeof candidate["controlId"] !== "string" || candidate["controlId"].length < 1 ||
      candidate["controlId"].length > 2048 || typeof candidate["storageKey"] !== "string" ||
      !STORAGE_KEY_PATTERN.test(candidate["storageKey"]) || controls.has(candidate["controlId"]) ||
      storageKeys.has(candidate["storageKey"])) return undefined;
    controls.add(candidate["controlId"]);
    storageKeys.add(candidate["storageKey"]);
    entries.push({ controlId: candidate["controlId"], storageKey: candidate["storageKey"] });
  }
  return { version: 1, kind: "inspectorEditBufferManifest", entries };
}

function parseBufferRecord(
  value: string,
  expectedControlId: string,
): InspectorBufferRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!record(parsed) || (parsed["version"] !== 1 && parsed["version"] !== 2) ||
    parsed["kind"] !== "inspectorEditBuffer" || parsed["controlId"] !== expectedControlId ||
    typeof parsed["value"] !== "string" || parsed["value"].length > MAX_BUFFER_VALUE_LENGTH ||
    !Number.isSafeInteger(parsed["baseDocumentRevision"]) ||
    (parsed["baseDocumentRevision"] as number) < 0 ||
    (parsed["status"] !== "dirty" && parsed["status"] !== "invalid") ||
    (parsed["error"] !== undefined && (typeof parsed["error"] !== "string" ||
      parsed["error"].length > MAX_BUFFER_ERROR_LENGTH))) return undefined;
  if (parsed["version"] === 2 && (
    !Object.prototype.hasOwnProperty.call(parsed, "baseResourceRevisionToken") ||
    (parsed["baseResourceRevisionToken"] !== null &&
      (typeof parsed["baseResourceRevisionToken"] !== "string" ||
        parsed["baseResourceRevisionToken"].length < 1 ||
        parsed["baseResourceRevisionToken"].length > MAX_REVISION_TOKEN_LENGTH)) ||
    typeof parsed["baseCanonicalHash"] !== "string" ||
    !CANONICAL_HASH_PATTERN.test(parsed["baseCanonicalHash"])
  )) return undefined;
  return {
    version: parsed["version"],
    kind: "inspectorEditBuffer",
    controlId: expectedControlId,
    value: parsed["value"],
    baseDocumentRevision: parsed["baseDocumentRevision"] as number,
    ...(parsed["version"] === 2
      ? {
          baseResourceRevisionToken: parsed["baseResourceRevisionToken"] as string | null,
          baseCanonicalHash: parsed["baseCanonicalHash"] as string,
        }
      : {}),
    status: parsed["status"],
    ...(typeof parsed["error"] === "string" ? { error: parsed["error"] } : {}),
  };
}

export class InspectorBufferPersistence {
  private entries = new Map<string, string>();
  private readonly failedControls = new Set<string>();
  private readonly pendingBufferDeletes = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly bridge: EditBufferBridge,
    private readonly localResourceId: string,
    private readonly currentResourceRevisionToken: string | null = null,
  ) {}

  async restore(): Promise<InspectorBufferRestoreResult> {
    const manifestValue = await this.bridge.readEditBuffer(
      this.localResourceId,
      INSPECTOR_BUFFER_MANIFEST_KEY,
    );
    if (manifestValue === null) return { buffers: {} };
    const manifest = parseManifest(manifestValue.value);
    if (manifest === undefined) {
      return {
        buffers: {},
        warning: "Unfinished inspector text could not be indexed safely and was left untouched.",
      };
    }
    this.entries = new Map(manifest.entries.map((entry) => [entry.controlId, entry.storageKey]));
    const buffers: Record<string, InspectorRestoredEditBuffer> = {};
    let damaged = false;
    for (const entry of manifest.entries) {
      try {
        const stored = await this.bridge.readEditBuffer(this.localResourceId, entry.storageKey);
        const parsed = stored === null ? undefined : parseBufferRecord(stored.value, entry.controlId);
        if (parsed === undefined) {
          damaged = true;
          continue;
        }
        buffers[entry.controlId] = {
          value: parsed.value,
          baseDocumentRevision: parsed.baseDocumentRevision,
          ...(parsed.baseResourceRevisionToken === undefined
            ? {}
            : { baseResourceRevisionToken: parsed.baseResourceRevisionToken }),
          ...(parsed.baseCanonicalHash === undefined
            ? {}
            : { baseCanonicalHash: parsed.baseCanonicalHash }),
          status: parsed.status,
          ...(parsed.error === undefined ? {} : { error: parsed.error }),
          ...(parsed.baseResourceRevisionToken === undefined || parsed.baseCanonicalHash === undefined
            ? { recoveryConflict: "evidenceMissing" as const }
            : parsed.baseResourceRevisionToken !== this.currentResourceRevisionToken
              ? { recoveryConflict: "durableRevisionChanged" as const }
              : {}),
        };
      } catch {
        damaged = true;
      }
    }
    return {
      buffers,
      ...(damaged
        ? { warning: "Some unfinished inspector text could not be restored and was left untouched." }
        : {}),
    };
  }

  update(update: InspectorEditBufferUpdate): Promise<void> {
    const persist = async (): Promise<void> => {
      const pendingDelete = this.pendingBufferDeletes.get(update.controlId);
      if (pendingDelete !== undefined) {
        await this.bridge.deleteEditBuffer(this.localResourceId, pendingDelete);
        this.pendingBufferDeletes.delete(update.controlId);
        if (update.status === "committed" || update.status === "discarded") return;
      }
      if (update.status === "committed" || update.status === "discarded") {
        const storageKey = this.entries.get(update.controlId);
        if (storageKey === undefined) return;
        this.entries.delete(update.controlId);
        try {
          await this.writeManifest();
        } catch (error) {
          // The in-memory index must continue to represent the last known
          // durable manifest so a retry cannot skip this removal.
          this.entries.set(update.controlId, storageKey);
          throw error;
        }
        this.pendingBufferDeletes.set(update.controlId, storageKey);
        await this.bridge.deleteEditBuffer(this.localResourceId, storageKey);
        this.pendingBufferDeletes.delete(update.controlId);
        return;
      }
      if (update.controlId.length < 1 || update.controlId.length > 2048) {
        throw new Error("The unfinished inspector control identifier is invalid.");
      }
      if (!Number.isSafeInteger(update.baseDocumentRevision) || update.baseDocumentRevision < 0) {
        throw new Error("The document revision evidence for this unfinished value is invalid.");
      }
      let storageKey = this.entries.get(update.controlId);
      const newEntry = storageKey === undefined;
      if (storageKey === undefined) {
        if (this.entries.size >= MAX_BUFFER_ENTRIES) {
          throw new Error("Too many unfinished inspector values are already being protected.");
        }
        storageKey = this.availableStorageKey(update.controlId);
      }
      if (update.value.length > MAX_BUFFER_VALUE_LENGTH) {
        throw new Error("This unfinished value is too large to protect locally. Shorten it before leaving the bulletin.");
      }
      if (update.error !== undefined && update.error.length > MAX_BUFFER_ERROR_LENGTH) {
        throw new Error("This unfinished value’s validation message is too large to protect safely.");
      }
      if (update.baseResourceRevisionToken !== null && (
        update.baseResourceRevisionToken.length < 1 ||
        update.baseResourceRevisionToken.length > MAX_REVISION_TOKEN_LENGTH
      )) {
        throw new Error("The bulletin revision evidence for this unfinished value is invalid.");
      }
      if (!CANONICAL_HASH_PATTERN.test(update.baseCanonicalHash)) {
        throw new Error("The control-value evidence for this unfinished value is invalid.");
      }
      const value: InspectorBufferRecord = {
        version: 2,
        kind: "inspectorEditBuffer",
        controlId: update.controlId,
        value: update.value,
        baseDocumentRevision: update.baseDocumentRevision,
        baseResourceRevisionToken: update.baseResourceRevisionToken,
        baseCanonicalHash: update.baseCanonicalHash,
        status: update.status,
        ...(update.error === undefined ? {} : { error: update.error }),
      };
      await this.bridge.writeEditBuffer(this.localResourceId, storageKey, JSON.stringify(value));
      if (newEntry) {
        this.entries.set(update.controlId, storageKey);
        try {
          await this.writeManifest();
        } catch (error) {
          // Keep the in-memory index aligned with the durable manifest. The
          // value file may already exist, but the next retry will rewrite it
          // and must attempt the manifest addition again before reporting clean.
          this.entries.delete(update.controlId);
          throw error;
        }
      }
    };
    const operation = async (): Promise<void> => {
      await this.bridge.setEditBufferSaveState(this.localResourceId, "pending");
      try {
        await persist();
        this.failedControls.delete(update.controlId);
        await this.bridge.setEditBufferSaveState(
          this.localResourceId,
          this.failedControls.size === 0 ? "clean" : "failed",
        );
      } catch (error) {
        this.failedControls.add(update.controlId);
        try {
          await this.bridge.setEditBufferSaveState(this.localResourceId, "failed");
        } catch {
          // A failed/pending state already reported before the write remains a
          // host shutdown blocker even if this follow-up report is unavailable.
        }
        throw error;
      }
    };
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failedControls.size > 0) {
      throw new Error("Some unfinished inspector values are not yet protected locally. Correct or retry them before leaving this bulletin.");
    }
  }

  private availableStorageKey(controlId: string): string {
    const base = `cbb.inspector.${fnv1a64(controlId)}`;
    const used = new Set([...this.entries.values(), ...this.pendingBufferDeletes.values()]);
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}.${suffix}`)) suffix += 1;
    return `${base}.${suffix}`;
  }

  private async writeManifest(): Promise<void> {
    const entries = [...this.entries]
      .map(([controlId, storageKey]) => ({ controlId, storageKey }))
      .sort((left, right) => left.controlId.localeCompare(right.controlId));
    const manifest: InspectorBufferManifest = {
      version: 1,
      kind: "inspectorEditBufferManifest",
      entries,
    };
    if (entries.length === 0) {
      await this.bridge.deleteEditBuffer(this.localResourceId, INSPECTOR_BUFFER_MANIFEST_KEY);
    } else {
      await this.bridge.writeEditBuffer(
        this.localResourceId,
        INSPECTOR_BUFFER_MANIFEST_KEY,
        JSON.stringify(manifest),
      );
    }
  }
}
