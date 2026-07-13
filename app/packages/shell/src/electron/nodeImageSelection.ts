import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { M4SelectedImageInput } from "../ipc/nodeManagedImageImport.js";

export const M4_IMAGE_IMPORT_LIMITS = Object.freeze({
  rasterInputBytes: 64 * 1024 * 1024,
  svgInputBytes: 20 * 1024 * 1024,
});

interface StableIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

function identity(value: StableIdentity): StableIdentity {
  return {
    dev: value.dev,
    ino: value.ino,
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
    nlink: value.nlink,
  };
}

function same(left: StableIdentity, right: StableIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink;
}

function selectionFailure(): Error {
  const error = new Error("That image could not be opened as a stable local file.");
  error.name = "M4ImageSelectionError";
  return error;
}

function operationFor(path: string): {
  readonly operation: M4SelectedImageInput["operation"];
  readonly maximumBytes: number;
} {
  switch (extname(path).toLowerCase()) {
    case ".png":
    case ".jpg":
    case ".jpeg":
      return {
        operation: "canonicalizeRaster",
        maximumBytes: M4_IMAGE_IMPORT_LIMITS.rasterInputBytes,
      };
    case ".svg":
      return {
        operation: "sanitizeSvg",
        maximumBytes: M4_IMAGE_IMPORT_LIMITS.svgInputBytes,
      };
    default:
      throw selectionFailure();
  }
}

function expectedRasterSignature(path: string, bytes: Uint8Array): boolean {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") {
    return bytes.byteLength >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Main-process-only stable, no-follow read. A path is never returned over IPC. */
export async function readStableSelectedImage(pathValue: string): Promise<M4SelectedImageInput> {
  try {
    if (typeof pathValue !== "string" || pathValue.length < 1 ||
      typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0) {
      throw selectionFailure();
    }
    const path = resolve(pathValue);
    if (path !== pathValue) throw selectionFailure();
    const routed = operationFor(path);
    const beforeStats = await lstat(path, { bigint: true });
    const before = identity(beforeStats);
    if (beforeStats.isSymbolicLink() || !beforeStats.isFile() || before.nlink !== 1n ||
      before.size < 1n || before.size > BigInt(routed.maximumBytes)) throw selectionFailure();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedStats = await handle.stat({ bigint: true });
      const opened = identity(openedStats);
      if (!openedStats.isFile() || opened.nlink !== 1n || !same(before, opened)) {
        throw selectionFailure();
      }
      const bytes = new Uint8Array(Number(opened.size));
      let position = 0;
      while (position < bytes.byteLength) {
        const result = await handle.read(bytes, position, bytes.byteLength - position, position);
        if (result.bytesRead < 1) throw selectionFailure();
        position += result.bytesRead;
      }
      const extra = new Uint8Array(1);
      if ((await handle.read(extra, 0, 1, position)).bytesRead !== 0) throw selectionFailure();
      const after = identity(await handle.stat({ bigint: true }));
      if (!same(opened, after)) throw selectionFailure();
      if (routed.operation === "canonicalizeRaster" && !expectedRasterSignature(path, bytes)) {
        throw selectionFailure();
      }
      return Object.freeze({
        bytes,
        originalFilename: basename(path),
        operation: routed.operation,
      });
    } finally {
      await handle.close();
    }
  } catch {
    throw selectionFailure();
  }
}
