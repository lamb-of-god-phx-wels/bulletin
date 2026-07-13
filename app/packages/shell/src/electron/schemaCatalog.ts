import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createSchemaCatalog, type SchemaCatalog, type SchemaObject } from "@cbb/core";

/** Load the signed/bundled offline schema directory before a workspace opens. */
export async function loadM4SchemaCatalog(directory: string): Promise<SchemaCatalog> {
  if (!isAbsolute(directory)) throw new TypeError("The bundled schema directory must be absolute");
  const root = resolve(directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
  if (names.length === 0) throw new Error("The bundled schema catalog is empty");
  const schemas = new Map<string, SchemaObject>();
  for (const name of names) {
    const value = JSON.parse(await readFile(join(root, name), "utf8")) as SchemaObject;
    if (typeof value.$id !== "string" || value.$id.length === 0 || schemas.has(value.$id)) {
      throw new Error("The bundled schema catalog contains an invalid or duplicate schema id");
    }
    schemas.set(value.$id, value);
  }
  return createSchemaCatalog(schemas);
}
