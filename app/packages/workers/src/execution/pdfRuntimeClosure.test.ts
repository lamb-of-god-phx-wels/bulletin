import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import { pdfRuntimeCommand, verifyPdfRuntimeClosure } from "./pdfRuntimeClosure.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-pdf-runtime-"));
  roots.push(root);
  await Promise.all([mkdir(join(root, "bin")), mkdir(join(root, "lib"))]);
  const values = new Map<string, Uint8Array>([
    ["bin/pdfinfo", new TextEncoder().encode("pdfinfo")],
    ["bin/pdftocairo", new TextEncoder().encode("pdftocairo")],
    ["bin/qpdf", new TextEncoder().encode("qpdf")],
    ["bin/unauthorized", new TextEncoder().encode("not-authorized")],
    ["lib/ld-linux", new TextEncoder().encode("loader")],
    ["lib/libpoppler.so", new TextEncoder().encode("library")],
  ]);
  for (const [relativePath, bytes] of values) {
    const path = join(root, ...relativePath.split("/"));
    await writeFile(path, bytes, { mode: relativePath.startsWith("bin/") || relativePath === "lib/ld-linux" ? 0o700 : 0o600 });
    if (relativePath.startsWith("bin/") || relativePath === "lib/ld-linux") await chmod(path, 0o700);
  }
  const manifestValue = {
    files: [...values].map(([path, bytes]) => ({
      byteSize: bytes.byteLength,
      hash: hashBytes(bytes),
      path,
    })),
    kind: "cbbPdfRuntimeClosure",
    libraryDirectories: ["lib"],
    loaderPath: "lib/ld-linux",
    version: 1,
  };
  const manifestBytes = canonicalJsonBytes(manifestValue);
  const manifestPath = join(root, "cbb-pdf-runtime.json");
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  return {
    root,
    manifest: { path: manifestPath, hash: hashBytes(manifestBytes), byteSize: manifestBytes.byteLength },
    flattener: {
      path: join(root, "bin/pdftocairo"),
      hash: hashBytes(values.get("bin/pdftocairo")!),
      byteSize: values.get("bin/pdftocairo")!.byteLength,
    },
    inspector: {
      path: join(root, "bin/pdfinfo"),
      hash: hashBytes(values.get("bin/pdfinfo")!),
      byteSize: values.get("bin/pdfinfo")!.byteLength,
    },
    structuralInspector: {
      path: join(root, "bin/qpdf"),
      hash: hashBytes(values.get("bin/qpdf")!),
      byteSize: values.get("bin/qpdf")!.byteLength,
    },
  };
}

describe.runIf(process.platform === "linux")("signed PDF runtime closure", () => {
  it("verifies the exact canonical nofollow runtime tree", async () => {
    const value = await fixture();
    const closure = await verifyPdfRuntimeClosure(value);
    expect(closure).toMatchObject({
      root: value.root,
      loaderRelativePath: "lib/ld-linux",
      libraryRelativeDirectories: ["lib"],
    });
    expect(Object.isFrozen(closure)).toBe(true);
    expect(() => {
      (closure as unknown as { files: Map<string, unknown> }).files = new Map();
    }).toThrow();
    expect(pdfRuntimeCommand(closure, value.flattener.path, ["-v"]).at(-1)).toBe("-v");
    expect(() => pdfRuntimeCommand(closure, join(value.root, "bin/unauthorized"), []))
      .toThrowError(expect.objectContaining({ code: "CBB-SECURITY-0001" }));
  });

  it("rejects a tampered declared library", async () => {
    const value = await fixture();
    await writeFile(join(value.root, "lib/libpoppler.so"), "tampered");
    await expect(verifyPdfRuntimeClosure(value)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("rejects surplus files and directories", async () => {
    const value = await fixture();
    await mkdir(join(value.root, "surplus"));
    await writeFile(join(value.root, "surplus/file"), "unexpected");
    await expect(verifyPdfRuntimeClosure(value)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("rejects symlinks even when they resolve to declared bytes", async () => {
    const value = await fixture();
    const library = join(value.root, "lib/libpoppler.so");
    const target = join(value.root, "lib/real-library");
    await writeFile(target, await readFile(library));
    await rm(library);
    await symlink(target, library);
    await expect(verifyPdfRuntimeClosure(value)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("rejects declared files with a hardlink outside the runtime tree", async () => {
    const value = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "cbb-pdf-runtime-hardlink-"));
    roots.push(outside);
    await link(join(value.root, "lib/libpoppler.so"), join(outside, "linked-library"));
    await expect(verifyPdfRuntimeClosure(value)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });
});
