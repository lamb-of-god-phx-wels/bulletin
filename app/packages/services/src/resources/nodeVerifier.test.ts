import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashBytes,
  parseLocalResourceId,
} from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import {
  createNodeNoFollowResourceByteVerifier,
  RESOURCE_CLOSURE_LIMITS,
} from "./index.js";
import type {
  NoFollowResourceByteVerifier,
  ResourceByteVerificationRequest,
} from "./index.js";

const roots: string[] = [];
const LOCAL_ID = parseLocalResourceId("11111111-1111-4111-8111-111111111111");
const FONT_LOCAL_ID = parseLocalResourceId("22222222-2222-4222-8222-222222222222");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(label = "workspace"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cbb-${label}-`));
  roots.push(root);
  return root;
}

async function createAsset(root: string, bytes: Uint8Array): Promise<string> {
  const directory = join(root, "assets", LOCAL_ID);
  await mkdir(directory, { recursive: true });
  const target = join(directory, "canonical");
  await writeFile(target, bytes);
  return target;
}

async function createFontFace(
  root: string,
  faceId: string,
  bytes: Uint8Array,
): Promise<string> {
  const directory = join(root, "fonts", FONT_LOCAL_ID, "faces");
  await mkdir(directory, { recursive: true });
  const target = join(directory, faceId);
  await writeFile(target, bytes);
  return target;
}

function assetRequest(
  bytes: Uint8Array,
  overrides: Partial<ResourceByteVerificationRequest> = {},
): ResourceByteVerificationRequest {
  return {
    locator: { kind: "assetCanonical", localId: LOCAL_ID },
    expectedHash: hashBytes(bytes),
    expectedByteSize: bytes.byteLength,
    maximumByteSize: RESOURCE_CLOSURE_LIMITS.assetFileBytesHard,
    ...overrides,
  };
}

function fontRequest(
  faceId: string,
  bytes: Uint8Array,
): ResourceByteVerificationRequest {
  return {
    locator: { kind: "fontFace", localId: FONT_LOCAL_ID, faceId },
    expectedHash: hashBytes(bytes),
    expectedByteSize: bytes.byteLength,
    maximumByteSize: RESOURCE_CLOSURE_LIMITS.fontFaceBytesHard,
  };
}

async function verifierFor(root: string): Promise<NoFollowResourceByteVerifier> {
  return createNodeNoFollowResourceByteVerifier(root);
}

async function expectRedactedFailure(
  operation: Promise<unknown>,
  forbidden: readonly string[],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected verifier failure");
  } catch (error) {
    expect(error).toMatchObject({
      kind: "byteVerificationFailed",
      code: "CBB-SECURITY-0001",
      message: "No-follow resource byte verification failed",
    });
    const rendered = `${String(error)}\n${JSON.stringify(error)}`;
    for (const value of forbidden) expect(rendered).not.toContain(value);
  }
}

describe("Node no-follow resource verifier", () => {
  it("streams and verifies fixed-layout asset bytes with a closed result", async () => {
    const root = await temporaryRoot();
    const bytes = new Uint8Array(256 * 1024 + 17);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    await createAsset(root, bytes);

    const result = await (await verifierFor(root)).verify(assetRequest(bytes));
    expect(result).toEqual({
      observedHash: hashBytes(bytes),
      observedByteSize: bytes.byteLength,
    });
    expect(Reflect.ownKeys(result)).toEqual(["observedHash", "observedByteSize"]);
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("derives a font face location only from validated local and face ids", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("validated font fixture");
    await createFontFace(root, "regular_400", bytes);
    const result = await (await verifierFor(root)).verify(fontRequest("regular_400", bytes));
    expect(result.observedHash).toBe(hashBytes(bytes));
  });

  it("rejects invalid identity segments before they can escape the root", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot("outside");
    const bytes = new TextEncoder().encode("outside secret");
    await writeFile(join(outside, "secret"), bytes);
    const verifier = await verifierFor(root);

    const hostile = {
      ...fontRequest("regular", bytes),
      locator: {
        kind: "fontFace",
        localId: FONT_LOCAL_ID,
        faceId: "../../secret",
      },
    } as unknown as ResourceByteVerificationRequest;
    await expectRedactedFailure(verifier.verify(hostile), [root, outside, "secret"]);

    const hostileLocalId = {
      ...assetRequest(bytes),
      locator: { kind: "assetCanonical", localId: "../../outside" },
    } as unknown as ResourceByteVerificationRequest;
    await expectRedactedFailure(verifier.verify(hostileLocalId), [root, outside]);
  });

  it.runIf(process.platform !== "win32")(
    "rejects final and parent symlinks even when they point to regular files",
    async () => {
      const root = await temporaryRoot();
      const outside = await temporaryRoot("outside");
      const bytes = new TextEncoder().encode("outside bytes");
      const outsideFile = join(outside, "outside.bin");
      await writeFile(outsideFile, bytes);

      const assetDirectory = join(root, "assets", LOCAL_ID);
      await mkdir(assetDirectory, { recursive: true });
      await symlink(outsideFile, join(assetDirectory, "canonical"));
      const verifier = await verifierFor(root);
      await expectRedactedFailure(verifier.verify(assetRequest(bytes)), [root, outside]);

      await rm(join(root, "assets"), { recursive: true, force: true });
      await mkdir(join(outside, LOCAL_ID), { recursive: true });
      await writeFile(join(outside, LOCAL_ID, "canonical"), bytes);
      await symlink(outside, join(root, "assets"));
      await expectRedactedFailure(verifier.verify(assetRequest(bytes)), [root, outside]);
    },
  );

  it("rejects hardlinked and non-regular canonical entries", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("hardlink bytes");
    const source = join(root, "source.bin");
    await writeFile(source, bytes);
    const assetDirectory = join(root, "assets", LOCAL_ID);
    await mkdir(assetDirectory, { recursive: true });
    await link(source, join(assetDirectory, "canonical"));
    const verifier = await verifierFor(root);
    await expectRedactedFailure(verifier.verify(assetRequest(bytes)), [root]);

    await rm(join(assetDirectory, "canonical"));
    await mkdir(join(assetDirectory, "canonical"));
    await expectRedactedFailure(verifier.verify(assetRequest(bytes)), [root]);
  });

  it("rejects expected-size, observed-size, hash, and cap mismatches", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("12345678");
    await createAsset(root, bytes);
    const verifier = await verifierFor(root);

    await expectRedactedFailure(verifier.verify(assetRequest(bytes, {
      expectedByteSize: bytes.byteLength - 1,
    })), [root]);
    await expectRedactedFailure(verifier.verify(assetRequest(bytes, {
      maximumByteSize: bytes.byteLength - 1,
    })), [root]);
    await expectRedactedFailure(verifier.verify(assetRequest(bytes, {
      maximumByteSize: RESOURCE_CLOSURE_LIMITS.assetFileBytesHard + 1,
    })), [root]);
    await expectRedactedFailure(verifier.verify(assetRequest(bytes, {
      expectedHash: `sha256:${"f".repeat(64)}` as Sha256Hash,
    })), [root]);
  });

  it("rejects unknown request fields and redacts missing-root setup errors", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("bytes");
    await createAsset(root, bytes);
    const verifier = await verifierFor(root);
    const request = { ...assetRequest(bytes), path: "/etc/passwd" } as ResourceByteVerificationRequest;
    await expectRedactedFailure(verifier.verify(request), [root, "/etc/passwd"]);

    const missing = join(root, "private", "missing-workspace");
    await expectRedactedFailure(createNodeNoFollowResourceByteVerifier(missing), [root, missing]);
  });
});
