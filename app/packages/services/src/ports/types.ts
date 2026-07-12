import type { IdPort } from "@cbb/core";

export type FileEntryKind =
  | "file"
  | "directory"
  | "symbolicLink"
  | "other";

export interface FileEntryInfo {
  readonly kind: FileEntryKind;
  readonly size: number;
}

/** Durable filesystem primitives. Higher layers own all path validation. */
export interface DurableFileSystemPort {
  readFile(path: string): Promise<Uint8Array>;
  /** Read a regular file without following a symbolic link/reparse point. */
  readFileNoFollow(path: string, maximumBytes: number): Promise<Uint8Array>;
  /** Create, write, and fsync a new file; fail if it already exists. */
  writeFileExclusive(path: string, bytes: Uint8Array): Promise<void>;
  /** Atomically replace destination with a same-directory source file. */
  replaceFile(sourcePath: string, destinationPath: string): Promise<void>;
  /** Claim a same-directory destination without replacement, then move source. */
  moveFileNoReplace(sourcePath: string, destinationPath: string): Promise<boolean>;
  removeFile(path: string): Promise<void>;
  /** Remove only if the path is an empty directory; never recurse. */
  removeEmptyDirectory(path: string): Promise<boolean>;
  makeDirectory(path: string): Promise<void>;
  readDirectory(path: string): Promise<readonly string[]>;
  entryInfo(path: string): Promise<FileEntryInfo | undefined>;
  realPath(path: string): Promise<string>;
  /** Persist directory entry additions/removals/renames. */
  syncDirectory(path: string): Promise<void>;
}

export interface ClockPort {
  now(): Date;
}

export interface SchedulerPort {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export type ProcessIdentityStatus = "liveMatch" | "notLive" | "unknown";

export interface CurrentProcessIdentity {
  readonly pid: number;
  readonly hostUserDiscriminator: string;
  readonly processStartedAt: string;
}

export interface RecordedProcessIdentity extends CurrentProcessIdentity {
  readonly instanceId: string;
}

export interface ProcessIdentityPort {
  current(): CurrentProcessIdentity;
  check(recorded: RecordedProcessIdentity): Promise<ProcessIdentityStatus>;
}

export interface ServicePorts {
  readonly fileSystem: DurableFileSystemPort;
  readonly clock: ClockPort;
  readonly scheduler: SchedulerPort;
  readonly ids: IdPort;
  readonly processIdentity: ProcessIdentityPort;
}
