import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hexToSha256Hash } from "@cbb/core";
import type { ResourceStagingEntry } from "../resources/index.js";
import type { ResourceStagingBytePort } from "./nodeSandbox.js";

const FACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function failure(): TypeError {
  return new TypeError("CBB-SECURITY-0001: resource staging read failed");
}

function strictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function segments(entry: ResourceStagingEntry): readonly string[] {
  const locator = entry.locator;
  if (locator.kind === "assetCanonical") {
    return ["assets", locator.localId, "canonical"];
  }
  if (!FACE_ID.test(locator.faceId)) throw failure();
  return ["fonts", locator.localId, "faces", locator.faceId];
}

async function assertDirectoryChain(root: string, pathSegments: readonly string[]): Promise<void> {
  let current = root;
  for (const segment of pathSegments.slice(0, -1)) {
    current = join(current, segment);
    const stats = await lstat(current, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure();
  }
}

/** Fixed-layout, no-follow byte reader used only after closure verification. */
export async function createNodeResourceStagingBytePort(
  workspaceRoot: string,
): Promise<ResourceStagingBytePort> {
  let root: string;
  try {
    if (
      typeof workspaceRoot !== "string" || workspaceRoot.length === 0 ||
      typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0
    ) throw failure();
    root = await realpath(workspaceRoot);
    const stats = await lstat(root, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure();
  } catch {
    throw failure();
  }

  return Object.freeze({
    async read(entry: ResourceStagingEntry): Promise<Uint8Array> {
      try {
        if (
          entry === null || typeof entry !== "object" ||
          !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1 ||
          !/^sha256:[0-9a-f]{64}$/u.test(entry.hash)
        ) throw failure();
        const pathSegments = segments(entry);
        const candidate = resolve(root, ...pathSegments);
        if (!strictDescendant(root, candidate)) throw failure();
        await assertDirectoryChain(root, pathSegments);
        const before = await lstat(candidate, { bigint: true });
        if (
          before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
          before.size !== BigInt(entry.byteSize)
        ) throw failure();
        const canonical = await realpath(candidate);
        if (!strictDescendant(root, canonical)) throw failure();
        const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await handle.stat({ bigint: true });
          if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) throw failure();
          const bytes = new Uint8Array(entry.byteSize);
          const digest = createHash("sha256");
          let position = 0;
          while (position < bytes.byteLength) {
            const { bytesRead } = await handle.read(bytes, position, bytes.byteLength - position, position);
            if (bytesRead < 1) throw failure();
            digest.update(bytes.subarray(position, position + bytesRead));
            position += bytesRead;
          }
          const extra = Buffer.allocUnsafe(1);
          if ((await handle.read(extra, 0, 1, position)).bytesRead !== 0) throw failure();
          const after = await handle.stat({ bigint: true });
          if (after.nlink !== 1n || after.size !== opened.size || !sameFile(opened, after)) throw failure();
          if (hexToSha256Hash(digest.digest("hex")) !== entry.hash) throw failure();
          return bytes;
        } finally {
          await handle.close();
        }
      } catch {
        throw failure();
      }
    },
  });
}
