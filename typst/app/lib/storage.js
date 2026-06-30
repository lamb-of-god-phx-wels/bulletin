import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultProject } from "./defaults.js";
import { renderTypst } from "./render-typst.js";

const libDir = path.dirname(fileURLToPath(import.meta.url));
export const appDir = path.resolve(libDir, "..");
export const typstDir = path.resolve(appDir, "..");
export const repoRoot = path.resolve(typstDir, "..");
export const contentRoot = path.join(typstDir, "content");
export const pdfRoot = path.join(typstDir, "pdf");
export const schemaRoot = path.join(typstDir, "schema");
export const templateRoot = path.join(appDir, "templates");
export const publicRoot = path.join(appDir, "public");

export function projectDir(kind, name) {
  const safeName = validateName(name);
  return kind === "template"
    ? path.join(templateRoot, safeName)
    : path.join(contentRoot, safeName);
}

export function projectJsonPath(kind, name) {
  return path.join(projectDir(kind, name), kind === "template" ? "template.json" : "document.json");
}

export function projectTypstPath(kind, name) {
  return path.join(projectDir(kind, name), kind === "template" ? "template.typ" : "document.typ");
}

export async function listProjects(kind = "bulletin") {
  const root = kind === "template" ? templateRoot : contentRoot;
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  const projects = [];
  for (const entry of entries) {
    if (!isSafeName(entry)) continue;
    const jsonPath = projectJsonPath(kind, entry);
    try {
      const json = JSON.parse(await readFile(jsonPath, "utf8"));
      projects.push({ kind, name: json.name || entry, elementCount: json.elements?.length || 0 });
    } catch {
      // Ignore folders that are not app-managed projects.
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadProject(kind, name) {
  validateKind(kind);
  const jsonPath = projectJsonPath(kind, name);
  try {
    return normalizeProject(JSON.parse(await readFile(jsonPath, "utf8")), kind, name);
  } catch {
    const project = createDefaultProject({ kind, name });
    await saveProject(project);
    return project;
  }
}

export async function saveProject(project) {
  const clean = normalizeProject(project, project.kind, project.name);
  const dir = projectDir(clean.kind, clean.name);
  await mkdir(dir, { recursive: true });
  await writeFile(projectJsonPath(clean.kind, clean.name), JSON.stringify(clean, null, 2) + "\n");
  await writeFile(projectTypstPath(clean.kind, clean.name), renderTypst(clean));
  return clean;
}

export async function ensureRendered(kind, name) {
  const project = await loadProject(kind, name);
  await saveProject(project);
  return project;
}

export async function listAssets() {
  const assetsRoot = path.join(repoRoot, "assets");
  const results = [];
  await walkAssets(assetsRoot, results);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listSchemas() {
  await mkdir(schemaRoot, { recursive: true });
  const entries = await readdir(schemaRoot);
  const schemas = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".schema.json")) continue;
    const schema = JSON.parse(await readFile(path.join(schemaRoot, entry), "utf8"));
    schemas.push({ file: entry, schema });
  }
  return schemas;
}

export function resolveAssetPath(assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  const resolved = path.resolve(repoRoot, normalized);
  const assetsRoot = path.resolve(repoRoot, "assets");
  if (!resolved.startsWith(assetsRoot + path.sep)) throw httpError(403, "Asset path is outside assets.");
  return resolved;
}

export function normalizeAssetPath(assetPath = "") {
  let value = String(assetPath).trim().replaceAll("\\", "/");
  value = value.replace(/^\.\.\/\.\.\/\.\.\//, "");
  value = value.replace(/^\/+/, "");
  if (!value.startsWith("assets/")) value = `assets/${value}`;
  if (value.includes("..")) throw httpError(400, "Invalid asset path.");
  return value;
}

export function validateKind(kind) {
  if (kind !== "bulletin" && kind !== "template") throw httpError(400, "Kind must be bulletin or template.");
  return kind;
}

export function validateName(name) {
  if (!isSafeName(name)) throw httpError(400, "Names may contain letters, numbers, spaces, underscores, and hyphens only.");
  return name;
}

export function isSafeName(name) {
  return /^[A-Za-z0-9 _-]{1,64}$/.test(String(name || "")) && !String(name).includes("..");
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizeProject(project, kind, name) {
  const base = createDefaultProject({ kind: validateKind(kind || project.kind || "bulletin"), name: validateName(name || project.name || "Untitled") });
  return {
    ...base,
    ...project,
    kind: validateKind(project.kind || base.kind),
    name: validateName(project.name || base.name),
    page: { ...base.page, ...project.page },
    elements: Array.isArray(project.elements) ? project.elements.map(normalizeElement) : base.elements,
  };
}

function normalizeElement(element) {
  const normalized = {
    id: element.id || `el_${Date.now().toString(36)}`,
    type: element.type || "text",
    name: element.name || element.type || "Element",
    x: lengthOr(element.x, 40),
    y: lengthOr(element.y, 40),
    width: lengthOr(element.width, 200),
    height: lengthOr(element.height, 90),
    margin: lengthOr(element.margin, 0),
    padding: lengthOr(element.padding, 8),
    style: {
      font: element.style?.font || "Calibri",
      fontSize: lengthOr(element.style?.fontSize, 11),
      fontWeight: element.style?.fontWeight || "regular",
      fontStyle: element.style?.fontStyle || "normal",
      color: element.style?.color || "#251d18",
      background: element.style?.background || "transparent",
      borderColor: element.style?.borderColor || "#d8cdbd",
      borderWidth: lengthOr(element.style?.borderWidth, 0),
      align: element.style?.align || "left",
    },
    schema: Array.isArray(element.schema) ? element.schema : [],
    data: element.data && typeof element.data === "object" ? element.data : {},
  };
  if (element.bindings && typeof element.bindings === "object") normalized.bindings = element.bindings;
  if (Array.isArray(element.children)) normalized.children = element.children;
  if (element.elementSchemaId) normalized.elementSchemaId = element.elementSchemaId;
  return normalized;
}

async function walkAssets(dir, results) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");
    if (relative === "assets/church/information.md") continue;
    if (entry.isDirectory()) {
      await walkAssets(fullPath, results);
    } else if (/\.(png|jpe?g|gif|svg|webp)$/i.test(entry.name)) {
      const info = await stat(fullPath);
      results.push({ path: relative, name: entry.name, size: info.size });
    }
  }
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function lengthOr(value, fallback) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "auto" || /^-?[0-9]+(\.[0-9]+)?(pt|in|cm|mm|em|%|fr)$/.test(trimmed)) return trimmed;
  }
  return numberOr(value, fallback);
}
