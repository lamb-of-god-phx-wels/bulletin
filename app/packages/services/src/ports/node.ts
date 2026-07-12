import { link, open, lstat, mkdir, readdir, readFile, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { hostname, userInfo } from "node:os";
import { hashBytes, type IdPort } from "@cbb/core";
import type {
  ClockPort,
  DurableFileSystemPort,
  ProcessIdentityPort,
  SchedulerPort,
  ServicePorts,
} from "./types.js";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

export function createNodeFileSystemPort(): DurableFileSystemPort {
  return {
    async readFile(path) {
      return new Uint8Array(await readFile(path));
    },
    async readFileNoFollow(path, maximumBytes) {
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
        throw new RangeError("No-follow read cap must be a nonnegative safe integer");
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("No-follow read target is not a regular file");
        if (stat.nlink !== 1) throw new Error("No-follow read target has an unsafe hard-link count");
        if (!Number.isSafeInteger(stat.size) || stat.size > maximumBytes) {
          throw new RangeError("No-follow read target exceeds its byte cap");
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        let position = 0;
        while (true) {
          const remainingWithSentinel = maximumBytes - total + 1;
          const buffer = new Uint8Array(Math.min(64 * 1024, remainingWithSentinel));
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maximumBytes) {
            throw new RangeError("No-follow read target exceeds its byte cap");
          }
          chunks.push(buffer.slice(0, bytesRead));
          position += bytesRead;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const final = await handle.stat();
        if (
          !final.isFile() ||
          final.nlink !== 1 ||
          final.dev !== stat.dev ||
          final.ino !== stat.ino ||
          final.size !== bytes.byteLength ||
          final.mtimeMs !== stat.mtimeMs ||
          final.ctimeMs !== stat.ctimeMs
        ) {
          throw new Error("No-follow read target changed while it was being read");
        }
        return bytes;
      } finally {
        await handle.close();
      }
    },
    async writeFileExclusive(path, bytes) {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    async replaceFile(sourcePath, destinationPath) {
      await rename(sourcePath, destinationPath);
    },
    async moveFileNoReplace(sourcePath, destinationPath) {
      try {
        await link(sourcePath, destinationPath);
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        if (code === "EEXIST" || code === "ENOENT") return false;
        throw error;
      }
      const [source, destination] = await Promise.all([
        lstat(sourcePath, { bigint: true }),
        lstat(destinationPath, { bigint: true }),
      ]);
      if (
        !source.isFile() ||
        !destination.isFile() ||
        source.dev !== destination.dev ||
        source.ino !== destination.ino
      ) {
        throw new Error("No-replace move could not preserve file identity");
      }
      await unlink(sourcePath);
      return true;
    },
    async removeFile(path) {
      try {
        await unlink(path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
    async removeEmptyDirectory(path) {
      try {
        await rmdir(path);
        return true;
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") return false;
        throw error;
      }
    },
    async makeDirectory(path) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    },
    async readDirectory(path) {
      try {
        return (await readdir(path)).sort();
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
    async entryInfo(path) {
      try {
        const value = await lstat(path);
        return {
          kind: value.isSymbolicLink()
            ? "symbolicLink"
            : value.isFile()
              ? "file"
              : value.isDirectory()
                ? "directory"
                : "other",
          size: value.size,
        };
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async realPath(path) {
      return realpath(path);
    },
    async syncDirectory(path) {
      const handle = await open(path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
}

export const nodeClock: ClockPort = { now: () => new Date() };

export const nodeScheduler: SchedulerPort = {
  setInterval(callback, milliseconds) {
    return globalThis.setInterval(callback, milliseconds);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export const nodeIdPort: IdPort = { randomUuid: () => randomUUID() };

const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const hostUserDiscriminator = hashBytes(
  new TextEncoder().encode(`${hostname()}\u0000${userInfo().username}`),
);

export function createNodeProcessIdentityPort(): ProcessIdentityPort {
  return {
    current() {
      return {
        pid: process.pid,
        hostUserDiscriminator,
        processStartedAt,
      };
    },
    async check(recorded) {
      if (recorded.hostUserDiscriminator !== hostUserDiscriminator) return "unknown";
      if (recorded.pid === process.pid) {
        return recorded.processStartedAt === processStartedAt ? "liveMatch" : "notLive";
      }
      try {
        process.kill(recorded.pid, 0);
        // Node cannot portably prove the start time of another process. A live
        // PID is therefore uncertain rather than assumed to be the holder.
        return "unknown";
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        return code === "ESRCH" ? "notLive" : "unknown";
      }
    },
  };
}

export function createNodeServicePorts(): ServicePorts {
  return {
    fileSystem: createNodeFileSystemPort(),
    clock: nodeClock,
    scheduler: nodeScheduler,
    ids: nodeIdPort,
    processIdentity: createNodeProcessIdentityPort(),
  };
}
