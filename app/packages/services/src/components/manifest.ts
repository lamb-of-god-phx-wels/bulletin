import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  canonicalJsonBytes,
  hashBytes,
} from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import {
  TRUSTED_COMPONENT_ROLES,
  TrustedComponentError,
} from "./types.js";
import type {
  TrustedComponentArch,
  TrustedComponentManifestContent,
  TrustedComponentManifestEntry,
  TrustedComponentPlatform,
  TrustedComponentRole,
  TrustedPublicKeyRegistry,
  VerifiedTrustedComponentManifest,
} from "./types.js";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u;
const PATH_SEGMENT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/u;
const SIGNATURE_RE = /^[A-Za-z0-9+/]{86}==$/u;
const WINDOWS_DEVICE_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const TRUSTED_COMPONENT_LIMITS = Object.freeze({
  maximumEntries: 1_024,
  maximumTotalBytes: 4 * GIB,
  maximumPathDepth: 16,
  maximumPathLength: 1_024,
  roleByteCaps: Object.freeze({
    typstCli: 500 * MIB,
    bookletCompositor: 500 * MIB,
    pdfUaValidator: 1 * GIB,
    bundledFontFace: 50 * MIB,
    schemaCatalog: 100 * MIB,
    localeData: 100 * MIB,
    genericStarterSet: 500 * MIB,
  }) satisfies Readonly<Record<TrustedComponentRole, number>>,
});

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function componentKey(entry: Pick<TrustedComponentManifestEntry, "role" | "id">): string {
  return `${entry.role}\u0000${entry.id}`;
}

function fail(kind: ConstructorParameters<typeof TrustedComponentError>[0], subject?: string): never {
  throw new TrustedComponentError(kind, undefined, subject);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedSet.has(key)) fail("invalidManifest");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalidManifest");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("invalidManifest");
  }
}

function assertClosedArray(value: unknown): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("invalidManifest");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      fail("invalidManifest");
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= value.length) fail("invalidManifest");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalidManifest");
    }
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail("invalidManifest");
  }
}

function isRole(value: unknown): value is TrustedComponentRole {
  return typeof value === "string" &&
    (TRUSTED_COMPONENT_ROLES as readonly string[]).includes(value);
}

function isPlatform(value: unknown): value is TrustedComponentPlatform {
  return value === "linux" || value === "win32";
}

function isArch(value: unknown): value is TrustedComponentArch {
  return value === "x64" || value === "arm64";
}

/** Validate a portable, app-owned package-relative component path. */
export function trustedComponentPathSegments(value: unknown): readonly string[] {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > TRUSTED_COMPONENT_LIMITS.maximumPathLength ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.includes(":")
  ) {
    fail("invalidManifest");
  }
  const segments = value.split("/");
  if (
    segments.length < 1 ||
    segments.length > TRUSTED_COMPONENT_LIMITS.maximumPathDepth ||
    segments.some((segment) =>
      segment === "." ||
      segment === ".." ||
      segment.includes("..") ||
      WINDOWS_DEVICE_RE.test(segment) ||
      !PATH_SEGMENT_RE.test(segment),
    )
  ) {
    fail("invalidManifest");
  }
  return Object.freeze(segments);
}

function normalizeEntry(raw: unknown): TrustedComponentManifestEntry {
  if (!plainRecord(raw)) fail("invalidManifest");
  exactKeys(
    raw,
    ["role", "id", "version", "platform", "arch", "relativePath", "hash", "byteSize"],
    ["role", "id", "version", "platform", "arch", "relativePath", "hash", "byteSize"],
  );
  if (!isRole(raw["role"])) fail("invalidManifest");
  if (typeof raw["id"] !== "string" || !TOKEN_RE.test(raw["id"])) fail("invalidManifest");
  if (typeof raw["version"] !== "string" || !VERSION_RE.test(raw["version"])) fail("invalidManifest", `${raw["role"]}:${raw["id"]}`);
  if (!isPlatform(raw["platform"]) || !isArch(raw["arch"])) fail("invalidManifest", `${raw["role"]}:${raw["id"]}`);
  trustedComponentPathSegments(raw["relativePath"]);
  const relativePath = raw["relativePath"] as string;
  if (typeof raw["hash"] !== "string" || !SHA256_RE.test(raw["hash"])) fail("invalidManifest", `${raw["role"]}:${raw["id"]}`);
  const cap = TRUSTED_COMPONENT_LIMITS.roleByteCaps[raw["role"]];
  if (
    !Number.isSafeInteger(raw["byteSize"]) ||
    (raw["byteSize"] as number) < 1 ||
    (raw["byteSize"] as number) > cap
  ) {
    fail("resourceLimitExceeded", `${raw["role"]}:${raw["id"]}`);
  }
  const byteSize = raw["byteSize"] as number;
  return Object.freeze({
    role: raw["role"],
    id: raw["id"],
    version: raw["version"],
    platform: raw["platform"],
    arch: raw["arch"],
    relativePath,
    hash: raw["hash"] as Sha256Hash,
    byteSize,
  });
}

function normalizeContent(raw: unknown): TrustedComponentManifestContent {
  if (!plainRecord(raw)) fail("invalidManifest");
  exactKeys(
    raw,
    ["version", "kind", "signingKeyId", "components"],
    ["version", "kind", "signingKeyId", "components"],
  );
  if (raw["version"] !== 1 || raw["kind"] !== "trustedComponentManifest") fail("invalidManifest");
  if (typeof raw["signingKeyId"] !== "string" || !TOKEN_RE.test(raw["signingKeyId"])) fail("invalidManifest");
  assertClosedArray(raw["components"]);
  if (
    raw["components"].length < 1 ||
    raw["components"].length > TRUSTED_COMPONENT_LIMITS.maximumEntries
  ) {
    fail("resourceLimitExceeded");
  }

  const components = raw["components"].map(normalizeEntry);
  const keys = new Set<string>();
  const paths = new Set<string>();
  let priorKey: string | undefined;
  let totalBytes = 0;
  for (const component of components) {
    const key = componentKey(component);
    if (keys.has(key)) fail("duplicateComponent", `${component.role}:${component.id}`);
    if (priorKey !== undefined && compareText(priorKey, key) >= 0) {
      fail("nonCanonicalOrder", `${component.role}:${component.id}`);
    }
    const pathKey = component.relativePath.toLowerCase();
    if (paths.has(pathKey)) fail("duplicatePath", `${component.role}:${component.id}`);
    keys.add(key);
    paths.add(pathKey);
    priorKey = key;
    totalBytes += component.byteSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > TRUSTED_COMPONENT_LIMITS.maximumTotalBytes) {
      fail("resourceLimitExceeded");
    }
  }

  return Object.freeze({
    version: 1,
    kind: "trustedComponentManifest",
    signingKeyId: raw["signingKeyId"],
    components: Object.freeze(components),
  });
}

/** RFC 8785 bytes signed by release tooling; the signature field is absent. */
export function trustedComponentSigningBytes(content: unknown): Uint8Array {
  return canonicalJsonBytes(normalizeContent(content));
}

function decodeSignature(value: unknown): Uint8Array {
  if (typeof value !== "string" || !SIGNATURE_RE.test(value)) fail("invalidSignature");
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== 64 || bytes.toString("base64") !== value) fail("invalidSignature");
  return bytes;
}

export interface VerifyTrustedComponentManifestOptions {
  readonly manifest: unknown;
  readonly trustedKeys: TrustedPublicKeyRegistry;
  readonly expectedPlatform: TrustedComponentPlatform;
  readonly expectedArch: TrustedComponentArch;
}

/** Validate the closed manifest, verify its Ed25519 signature, and pin platform. */
export function verifyTrustedComponentManifest(
  options: VerifyTrustedComponentManifestOptions,
): VerifiedTrustedComponentManifest {
  const raw = options.manifest;
  if (!plainRecord(raw)) fail("invalidManifest");
  exactKeys(
    raw,
    ["version", "kind", "signingKeyId", "components", "signature"],
    ["version", "kind", "signingKeyId", "components", "signature"],
  );
  const content = normalizeContent({
    version: raw["version"],
    kind: raw["kind"],
    signingKeyId: raw["signingKeyId"],
    components: raw["components"],
  });
  const signature = decodeSignature(raw["signature"]);
  let keyDer: Uint8Array | undefined;
  try {
    keyDer = options.trustedKeys.getEd25519PublicKey(content.signingKeyId);
  } catch {
    fail("unknownSigningKey", content.signingKeyId);
  }
  if (keyDer === undefined) fail("unknownSigningKey", content.signingKeyId);

  let valid = false;
  const signingBytes = canonicalJsonBytes(content);
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(keyDer),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") fail("invalidSigningKey", content.signingKeyId);
    valid = verifySignature(null, signingBytes, publicKey, signature);
  } catch (error) {
    if (error instanceof TrustedComponentError) throw error;
    fail("invalidSigningKey", content.signingKeyId);
  }
  if (!valid) fail("invalidSignature", content.signingKeyId);

  for (const component of content.components) {
    if (
      component.platform !== options.expectedPlatform ||
      component.arch !== options.expectedArch
    ) {
      fail("platformMismatch", `${component.role}:${component.id}`);
    }
  }

  return Object.freeze({
    ...content,
    signature: raw["signature"],
    manifestHash: hashBytes(signingBytes),
  }) as VerifiedTrustedComponentManifest;
}
