import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  hexToSha256Hash,
  isLocalResourceId,
} from "@cbb/core";
import type {
  NoFollowResourceByteVerifier,
  ResourceByteLocator,
  ResourceByteVerificationRequest,
  ResourceByteVerificationResult,
} from "./types.js";
import { ResourceContractError } from "./types.js";
import { RESOURCE_CLOSURE_LIMITS } from "./resolve.js";

const FACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const READ_CHUNK_BYTES = 64 * 1024;

function verificationFailure(subject?: string): ResourceContractError {
  return new ResourceContractError(
    "byteVerificationFailed",
    "CBB-SECURITY-0001",
    "No-follow resource byte verification failed",
    subject,
  );
}

function locatorSubject(locator: unknown): string | undefined {
  if (locator === null || typeof locator !== "object") return undefined;
  const value = locator as Record<string, unknown>;
  if (
    value["kind"] === "assetCanonical" &&
    typeof value["localId"] === "string" &&
    isLocalResourceId(value["localId"])
  ) {
    return value["localId"];
  }
  if (
    value["kind"] === "fontFace" &&
    typeof value["localId"] === "string" &&
    isLocalResourceId(value["localId"]) &&
    typeof value["faceId"] === "string" &&
    FACE_ID_RE.test(value["faceId"])
  ) {
    return `${value["localId"]}:${value["faceId"]}`;
  }
  return undefined;
}

function validateLocator(locator: ResourceByteLocator): readonly string[] {
  if (
    locator === null ||
    typeof locator !== "object" ||
    typeof locator.kind !== "string" ||
    typeof locator.localId !== "string" ||
    !isLocalResourceId(locator.localId)
  ) {
    throw verificationFailure();
  }
  if (locator.kind === "assetCanonical") {
    if (Reflect.ownKeys(locator).some((key) => !["kind", "localId"].includes(String(key)))) {
      throw verificationFailure(locator.localId);
    }
    return ["assets", locator.localId, "canonical"];
  }
  if (
    locator.kind === "fontFace" &&
    typeof locator.faceId === "string" &&
    FACE_ID_RE.test(locator.faceId)
  ) {
    if (Reflect.ownKeys(locator).some((key) => !["kind", "localId", "faceId"].includes(String(key)))) {
      throw verificationFailure(locatorSubject(locator));
    }
    return ["fonts", locator.localId, "faces", locator.faceId];
  }
  throw verificationFailure(locatorSubject(locator));
}

function locatorHardCap(locator: ResourceByteLocator): number {
  return locator.kind === "assetCanonical"
    ? RESOURCE_CLOSURE_LIMITS.assetFileBytesHard
    : RESOURCE_CLOSURE_LIMITS.fontFaceBytesHard;
}

function validateRequest(request: ResourceByteVerificationRequest): readonly string[] {
  if (
    request === null ||
    typeof request !== "object" ||
    Reflect.ownKeys(request).some((key) =>
      !["locator", "expectedHash", "expectedByteSize", "maximumByteSize"].includes(String(key)),
    ) ||
    typeof request.expectedHash !== "string" ||
    !SHA256_RE.test(request.expectedHash) ||
    !Number.isSafeInteger(request.expectedByteSize) ||
    request.expectedByteSize < 1 ||
    !Number.isSafeInteger(request.maximumByteSize) ||
    request.maximumByteSize < 1
  ) {
    throw verificationFailure();
  }
  const segments = validateLocator(request.locator);
  const hardCap = locatorHardCap(request.locator);
  if (
    request.maximumByteSize > hardCap ||
    request.expectedByteSize > request.maximumByteSize
  ) {
    throw verificationFailure(locatorSubject(request.locator));
  }
  return segments;
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

async function assertDirectoryChain(
  root: string,
  segments: readonly string[],
): Promise<void> {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const stats = await lstat(current, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw verificationFailure();
    }
  }
}

function sameFileIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function verifyCandidate(
  root: string,
  request: ResourceByteVerificationRequest,
  segments: readonly string[],
): Promise<ResourceByteVerificationResult> {
  const subject = locatorSubject(request.locator);
  const candidate = resolve(root, ...segments);
  if (!isStrictDescendant(root, candidate)) throw verificationFailure(subject);

  await assertDirectoryChain(root, segments);
  const before = await lstat(candidate, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(request.maximumByteSize) ||
    before.size !== BigInt(request.expectedByteSize)
  ) {
    throw verificationFailure(subject);
  }

  const canonicalCandidate = await realpath(candidate);
  if (!isStrictDescendant(root, canonicalCandidate)) {
    throw verificationFailure(subject);
  }

  const handle = await open(
    candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.size !== before.size ||
      !sameFileIdentity(before, opened)
    ) {
      throw verificationFailure(subject);
    }

    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let observedByteSize = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) break;
      observedByteSize += bytesRead;
      if (observedByteSize > request.maximumByteSize) {
        throw verificationFailure(subject);
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    if (
      observedByteSize !== request.expectedByteSize ||
      after.nlink !== 1n ||
      after.size !== BigInt(observedByteSize) ||
      !sameFileIdentity(opened, after)
    ) {
      throw verificationFailure(subject);
    }

    const observedHash = hexToSha256Hash(digest.digest("hex"));
    if (observedHash !== request.expectedHash) {
      throw verificationFailure(subject);
    }
    return Object.freeze({
      observedHash,
      observedByteSize,
    });
  } finally {
    await handle.close();
  }
}

/**
 * Construct the production fixed-layout verifier for one trusted workspace.
 *
 * workspaceRoot is service configuration, never a build/import request field.
 * It is resolved once; all later resource paths are derived solely from the
 * validated fixed-layout locator.
 */
export async function createNodeNoFollowResourceByteVerifier(
  workspaceRoot: string,
): Promise<NoFollowResourceByteVerifier> {
  let root: string;
  try {
    if (
      typeof workspaceRoot !== "string" ||
      workspaceRoot.length === 0 ||
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0
    ) {
      throw verificationFailure();
    }
    root = await realpath(workspaceRoot);
    const rootStats = await lstat(root, { bigint: true });
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw verificationFailure();
    }
  } catch {
    throw verificationFailure();
  }

  return Object.freeze({
    async verify(request: ResourceByteVerificationRequest) {
      let segments: readonly string[];
      try {
        segments = validateRequest(request);
        return await verifyCandidate(root, request, segments);
      } catch {
        // Node errors may contain absolute paths. Collapse every failure at
        // this boundary to the fixed redacted diagnostic.
        throw verificationFailure(locatorSubject(request?.locator));
      }
    },
  });
}
