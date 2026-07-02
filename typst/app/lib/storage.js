import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultProject } from "./defaults.js";
import { renderTypst } from "./render-typst.js";

const pxPerIn = 96;
const ptPerPx = 0.75;

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
  await writeFile(projectTypstPath(clean.kind, clean.name), renderTypst(clean, { assetPrefix: assetPrefixForProject(clean.kind) }));
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
  const sourceElements = Array.isArray(project.elements) ? project.elements : base.elements;
  const elements = sourceElements.some(hasLegacyCoordinates)
    ? [...sourceElements].sort(compareLegacyFlow).map(normalizeElement)
    : sourceElements.map(normalizeElement);
  return {
    ...base,
    ...project,
    kind: validateKind(project.kind || base.kind),
    name: validateName(project.name || base.name),
    page: normalizePage(project.page, base.page),
    elements,
  };
}

function normalizePage(page = {}, basePage) {
  const merged = { ...basePage, ...page };
  return {
    ...merged,
    width: numberOr(merged.width, basePage.width),
    height: numberOr(merged.height, basePage.height),
    typstWidth: typstLengthOr(merged.typstWidth, basePage.typstWidth),
    typstHeight: typstLengthOr(merged.typstHeight, basePage.typstHeight),
    background: merged.background || "#ffffff",
    margins: normalizeMargins(merged.margins),
  };
}

function normalizeMargins(margins = {}) {
  return {
    top: lengthOr(margins.top, 0),
    right: lengthOr(margins.right ?? margins.outer, 0),
    bottom: lengthOr(margins.bottom, 0),
    left: lengthOr(margins.left ?? margins.inner, 0),
  };
}

function normalizeElement(element) {
  const normalized = {
    id: element.id || `el_${Date.now().toString(36)}`,
    type: element.type || "text",
    name: element.name || element.type || "Element",
    width: lengthOr(element.width, "100%"),
    height: lengthOr(element.height, 90),
    margin: lengthOr(element.margin, 0),
    padding: lengthOr(element.padding, element.type === "canvas" ? 0 : 8),
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
  if (normalized.type === "grid") {
    normalized.children = normalizeGridChildren(element, normalized);
    delete normalized.data.cells;
  } else if (normalized.type === "stack") {
    normalized.children = normalizeStackChildren(element, normalized);
    delete normalized.data.items;
  } else if (normalized.type === "pageBreak") {
    normalized.data = {};
  } else if (normalized.type === "canvas") {
    normalized.data = {};
    normalized.children = Array.isArray(element.children) ? element.children.map(normalizeCanvasChild) : [];
    enforceCanvasMinimum(normalized);
  } else if (Array.isArray(element.children)) {
    normalized.children = element.children.map(normalizeElement);
  }
  if (element.elementSchemaId) normalized.elementSchemaId = element.elementSchemaId;
  return normalized;
}

function normalizeGridChildren(source, normalized) {
  if (Array.isArray(source.children) && source.children.length > 0) return source.children.map(normalizeElement);
  const cells = Array.isArray(source.data?.cells) ? source.data.cells : [];
  return cells.filter((cell) => String(cell ?? "").trim()).map((cell, index) => textChild(`Cell ${index + 1}`, String(cell)));
}

function normalizeStackChildren(source, normalized) {
  if (Array.isArray(source.children) && source.children.length > 0) return source.children.map(normalizeElement);
  const items = Array.isArray(source.data?.items) ? source.data.items : [];
  return items.filter((item) => String(item ?? "").trim()).map((item, index) => textChild(`Item ${index + 1}`, String(item)));
}

function textChild(name, text) {
  return normalizeElement({
    id: nextId("el"),
    type: "text",
    name,
    width: "100%",
    height: "auto",
    margin: 0,
    padding: 6,
    style: {
      font: "Calibri",
      fontSize: 11,
      fontWeight: "regular",
      fontStyle: "normal",
      color: "#251d18",
      background: "transparent",
      borderColor: "#d8cdbd",
      borderWidth: 0,
      align: "left",
    },
    schema: [],
    data: { text },
  });
}

function normalizeCanvasChild(child = {}) {
  const hasWrapper = child.element && typeof child.element === "object";
  const sourceElement = hasWrapper ? child.element : child;
  return {
    id: hasWrapper ? child.id || nextId("wrap") : nextId("wrap"),
    x: lengthOr(child.x, 0),
    y: lengthOr(child.y, 0),
    element: normalizeElement(sourceElement),
  };
}

function enforceCanvasMinimum(element) {
  const extent = canvasContentExtent(element);
  const width = absoluteNumber(element.width);
  const height = absoluteNumber(element.height);
  if (width !== null && width < extent.width) element.width = extent.width;
  if (height !== null && height < extent.height) element.height = extent.height;
}

function canvasContentExtent(element) {
  return (element.children || []).reduce((extent, child) => {
    const childWidth = absoluteNumber(child.element?.width) || 0;
    const childHeight = absoluteNumber(child.element?.height) || 0;
    return {
      width: Math.max(extent.width, coordinateValue(child.x) + childWidth),
      height: Math.max(extent.height, coordinateValue(child.y) + childHeight),
    };
  }, { width: 0, height: 0 });
}

function absoluteNumber(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text || text === "auto" || text.endsWith("%") || text.endsWith("fr")) return null;
  if (text.endsWith("pt")) return Number.parseFloat(text) / ptPerPx;
  if (text.endsWith("in")) return Number.parseFloat(text) * pxPerIn;
  if (text.endsWith("cm")) return (Number.parseFloat(text) / 2.54) * pxPerIn;
  if (text.endsWith("mm")) return (Number.parseFloat(text) / 25.4) * pxPerIn;
  if (text.endsWith("em")) return Number.parseFloat(text) * 16;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function nextId(prefix = "el") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function assetPrefixForProject(kind) {
  return kind === "template" ? "../../../../assets" : "../../../assets";
}

function hasLegacyCoordinates(element) {
  return element && (element.x !== undefined || element.y !== undefined);
}

function compareLegacyFlow(left, right) {
  return coordinateValue(left.y) - coordinateValue(right.y) || coordinateValue(left.x) - coordinateValue(right.x);
}

function coordinateValue(value) {
  const pixels = absoluteNumber(value);
  if (pixels !== null) return pixels;
  const number = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(number) ? number : 0;
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

function typstLengthOr(value, fallback) {
  if (typeof value === "string" && /^[0-9]+(\.[0-9]+)?(pt|in|cm|mm|em|%)$/.test(value.trim())) return value.trim();
  return fallback;
}
