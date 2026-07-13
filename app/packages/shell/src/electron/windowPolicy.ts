import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const M4_RENDERER_PARTITION = "cbb-m4-renderer" as const;

export interface M4SecureWebPreferences {
  readonly preload: string;
  readonly sandbox: true;
  readonly contextIsolation: true;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webviewTag: false;
  readonly webSecurity: true;
  readonly allowRunningInsecureContent: false;
  readonly spellcheck: true;
  readonly navigateOnDragDrop: false;
  readonly devTools: boolean;
  readonly partition: typeof M4_RENDERER_PARTITION;
}

export type M4TrustedRendererLocation =
  | { readonly kind: "file"; readonly indexPath: string }
  | { readonly kind: "development"; readonly url: string };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function normalizeDevelopmentUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("The renderer development URL is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isLoopback(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("The renderer development URL must be a credential-free loopback URL");
  }
  return url.href;
}

export interface SelectM4RendererLocationOptions {
  readonly isPackaged: boolean;
  readonly productionIndexPath: string;
  readonly developmentUrl: string | undefined;
}

/**
 * Select the renderer before constructing the BrowserWindow. Packaged builds
 * never honor the development override: doing so would otherwise turn an
 * environment variable into both a DevTools switch and an IPC trust grant.
 */
export function selectM4RendererLocation(
  options: SelectM4RendererLocationOptions,
): M4TrustedRendererLocation {
  if (options.isPackaged || options.developmentUrl === undefined) {
    return { kind: "file", indexPath: options.productionIndexPath };
  }
  return { kind: "development", url: normalizeDevelopmentUrl(options.developmentUrl) };
}

export function createSecureWebPreferences(
  preloadPath: string,
  allowDevelopmentTools = false,
): M4SecureWebPreferences {
  if (!isAbsolute(preloadPath)) throw new TypeError("The preload path must be absolute");
  return Object.freeze({
    preload: resolve(preloadPath),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: true,
    navigateOnDragDrop: false,
    devTools: allowDevelopmentTools,
    partition: M4_RENDERER_PARTITION,
  });
}

export function contentSecurityPolicy(location: M4TrustedRendererLocation): string {
  const development = location.kind === "development";
  const developmentUrl = development ? new URL(normalizeDevelopmentUrl(location.url)) : undefined;
  const websocketOrigin = developmentUrl === undefined
    ? undefined
    : `${developmentUrl.protocol === "https:" ? "wss:" : "ws:"}//${developmentUrl.host}`;
  return [
    "default-src 'none'",
    "script-src 'self'",
    development ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    // Editor geometry is applied through React's style property. Permit style
    // attributes without permitting inline scripts or production <style> tags.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    development ? `connect-src 'self' ${websocketOrigin}` : "connect-src 'none'",
    "worker-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function rendererStartUrl(location: M4TrustedRendererLocation): string {
  if (location.kind === "development") return normalizeDevelopmentUrl(location.url);
  if (!isAbsolute(location.indexPath)) throw new TypeError("The renderer index path must be absolute");
  return pathToFileURL(resolve(location.indexPath)).href;
}

export function isTrustedRendererUrl(
  rawUrl: string,
  location: M4TrustedRendererLocation,
): boolean {
  let candidate: URL;
  try {
    candidate = new URL(rawUrl);
  } catch {
    return false;
  }
  if (location.kind === "development") {
    const start = new URL(normalizeDevelopmentUrl(location.url));
    const allowedProtocols = start.protocol === "https:"
      ? new Set(["https:", "wss:"])
      : new Set(["http:", "ws:"]);
    return allowedProtocols.has(candidate.protocol) && candidate.username === "" && candidate.password === "" &&
      candidate.hostname === start.hostname && candidate.port === start.port;
  }
  if (candidate.protocol !== "file:" || !isAbsolute(location.indexPath)) return false;
  let candidatePath: string;
  try {
    candidatePath = resolve(fileURLToPath(candidate));
  } catch {
    return false;
  }
  const root = dirname(resolve(location.indexPath));
  const fromRoot = relative(root, candidatePath);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}
