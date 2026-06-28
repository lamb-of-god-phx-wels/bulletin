import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ensureRendered,
  httpError,
  listAssets,
  listProjects,
  loadProject,
  pdfRoot,
  projectTypstPath,
  publicRoot,
  repoRoot,
  resolveAssetPath,
  saveProject,
  validateKind,
  validateName,
} from "./lib/storage.js";

const port = Number(process.env.PORT || 5177);

await mkdir(pdfRoot, { recursive: true });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/projects" && req.method === "GET") {
      const kind = validateKind(url.searchParams.get("kind") || "bulletin");
      return sendJson(res, { ok: true, projects: await listProjects(kind) });
    }

    if (url.pathname === "/api/projects" && req.method === "POST") {
      const body = await readJson(req);
      const project = await loadProject(validateKind(body.kind || "bulletin"), validateName(body.name || "Untitled"));
      return sendJson(res, { ok: true, project });
    }

    if (url.pathname === "/api/project" && req.method === "GET") {
      const project = await loadProject(requireKind(url), requireName(url));
      return sendJson(res, { ok: true, project });
    }

    if (url.pathname === "/api/project" && req.method === "PUT") {
      const project = await saveProject(await readJson(req));
      return sendJson(res, { ok: true, project });
    }

    if (url.pathname === "/api/project/build" && req.method === "POST") {
      return sendJson(res, await buildProject(requireKind(url), requireName(url)));
    }

    if (url.pathname === "/api/assets" && req.method === "GET") {
      return sendJson(res, { ok: true, assets: await listAssets() });
    }

    if (url.pathname === "/asset" && req.method === "GET") {
      return await serveAsset(res, url.searchParams.get("path") || "");
    }

    if (url.pathname === "/pdf" && req.method === "GET") {
      return await servePdf(res, requireName(url));
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, { ok: false, error: error.message || "Unexpected server error" }, status);
  }
}).listen(port, () => {
  console.log(`Church Bulletin Builder running at http://localhost:${port}`);
});

async function buildProject(kind, name) {
  await ensureRendered(kind, name);
  const typstPath = projectTypstPath(kind, name);
  const pdfPath = path.join(pdfRoot, `${name}.pdf`);
  const result = await run("typst", [
    "compile",
    "--root",
    repoRoot,
    "--font-path",
    path.join(repoRoot, "assets/fonts"),
    typstPath,
    pdfPath,
  ], repoRoot);
  return { ok: result.status === 0, status: result.status, output: result.output };
}

async function servePdf(res, name) {
  const pdfPath = path.join(pdfRoot, `${validateName(name)}.pdf`);
  try {
    await stat(pdfPath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("PDF not built yet.");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
  createReadStream(pdfPath).pipe(res);
}

async function serveAsset(res, assetPath) {
  const filePath = resolveAssetPath(assetPath);
  try {
    await stat(filePath);
  } catch {
    throw httpError(404, "Asset not found.");
  }
  res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(res);
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicRoot, safePath));
  if (!filePath.startsWith(publicRoot)) throw httpError(403, "Forbidden");
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function requireKind(url) {
  return validateKind(url.searchParams.get("kind") || "bulletin");
}

function requireName(url) {
  return validateName(url.searchParams.get("name") || "");
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => resolve({ status: 127, output: error.message }));
    child.on("close", (status) => resolve({ status, output }));
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
