import {
  canonicalJsonBytes,
  hashCanonical,
  type CanonicalRevisionToken,
} from "@cbb/core";
import { dirname } from "node:path";
import type { DurableFileSystemPort } from "../ports/index.js";
import { decodeCanonicalJson } from "../ports/index.js";

export function decodeJson(bytes: Uint8Array): unknown {
  return decodeCanonicalJson(bytes);
}

export function canonicalToken(value: unknown): CanonicalRevisionToken {
  return hashCanonical(value) as CanonicalRevisionToken;
}

export async function writeJsonExclusive(
  fileSystem: DurableFileSystemPort,
  path: string,
  value: unknown,
): Promise<void> {
  await fileSystem.writeFileExclusive(path, canonicalJsonBytes(value));
  await fileSystem.syncDirectory(dirname(path));
}

export async function replaceJsonAtomically(
  fileSystem: DurableFileSystemPort,
  targetPath: string,
  tempPath: string,
  value: unknown,
  validate: (value: unknown) => void,
): Promise<void> {
  validate(value);
  const bytes = canonicalJsonBytes(value);
  await fileSystem.removeFile(tempPath);
  await fileSystem.writeFileExclusive(tempPath, bytes);
  const roundTrip = decodeJson(await fileSystem.readFileNoFollow(tempPath, bytes.byteLength));
  validate(roundTrip);
  if (canonicalToken(roundTrip) !== canonicalToken(value)) {
    throw new Error("Durable JSON verification hash mismatch");
  }
  await fileSystem.replaceFile(tempPath, targetPath);
  await fileSystem.syncDirectory(dirname(targetPath));
}
