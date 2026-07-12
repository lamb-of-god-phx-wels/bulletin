import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSchemaCatalog,
  type SchemaObject,
} from "@cbb/core";
import { parseWorkspaceRegistry } from "./registry.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const HASH = `sha256:${"a".repeat(64)}`;
const NOW = "2026-07-12T12:00:00.000Z";

function catalog() {
  const root = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(root).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(root, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function record(kind: string, storagePath: string) {
  return {
    localId: UUID_B,
    kind,
    displayName: "Resource",
    storagePath,
    contentHash: HASH,
    createdAt: NOW,
    modifiedAt: NOW,
  };
}

describe("workspace registry runtime validation", () => {
  const schemas = catalog();

  it("accepts fixed asset locations", () => {
    expect(() =>
      parseWorkspaceRegistry(
        {
          version: 1,
          kind: "workspace",
          workspaceId: UUID_A,
          assets: [record("asset", `assets/${UUID_B}/asset.json`)],
        },
        schemas,
      ),
    ).not.toThrow();
  });

  it("rejects arbitrary and noncanonical managed paths", () => {
    expect(() =>
      parseWorkspaceRegistry(
        {
          version: 1,
          kind: "workspace",
          workspaceId: UUID_A,
          assets: [record("asset", "/home/user/private")],
        },
        schemas,
      ),
    ).toThrow(/Unsafe workspace-relative path/);
    expect(() =>
      parseWorkspaceRegistry(
        {
          version: 1,
          kind: "workspace",
          workspaceId: UUID_A,
          assets: [record("asset", `assets/${UUID_B}/other.json`)],
        },
        schemas,
      ),
    ).toThrow(/non-canonical storage path/);
  });

  it("enforces the document-global local-id namespace across collections", () => {
    expect(() =>
      parseWorkspaceRegistry(
        {
          version: 1,
          kind: "workspace",
          workspaceId: UUID_A,
          assets: [record("asset", `assets/${UUID_B}/asset.json`)],
          fonts: [record("font", `fonts/${UUID_B}/font.json`)],
        },
        schemas,
      ),
    ).toThrow(/duplicate local resource id/);
  });
});
