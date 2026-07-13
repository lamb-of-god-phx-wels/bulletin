import { describe, expect, it } from "vitest";
import {
  M4_RENDERER_PARTITION,
  contentSecurityPolicy,
  createSecureWebPreferences,
  isTrustedRendererUrl,
  normalizeDevelopmentUrl,
  rendererStartUrl,
  selectM4RendererLocation,
} from "./windowPolicy.js";

describe("secure Electron renderer policy", () => {
  it("pins the sandbox and removes Node, webview, and insecure-content capabilities", () => {
    expect(createSecureWebPreferences("/opt/cbb/preload.js")).toEqual({
      preload: "/opt/cbb/preload.js",
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
      devTools: false,
      partition: M4_RENDERER_PARTITION,
    });
    expect(() => createSecureWebPreferences("relative/preload.js")).toThrow(/absolute/);
  });

  it("uses a production CSP without network, eval, inline script, frames, or objects", () => {
    const csp = contentSecurityPolicy({ kind: "file", indexPath: "/opt/cbb/renderer/index.html" });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("allows development only on credential-free loopback origins", () => {
    expect(normalizeDevelopmentUrl("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/");
    expect(rendererStartUrl({ kind: "development", url: "http://localhost:5173" }))
      .toBe("http://localhost:5173/");
    for (const url of [
      "https://example.com/",
      "http://user:password@localhost:5173/",
      "file:///tmp/index.html",
      "http://localhost:5173/?remote=true",
    ]) {
      expect(() => normalizeDevelopmentUrl(url)).toThrow();
    }
  });

  it("honors the loopback renderer override only outside packaged execution", () => {
    const productionIndexPath = "/opt/cbb/renderer/index.html";
    expect(selectM4RendererLocation({
      isPackaged: false,
      productionIndexPath,
      developmentUrl: "http://127.0.0.1:5173",
    })).toEqual({ kind: "development", url: "http://127.0.0.1:5173/" });

    const packaged = selectM4RendererLocation({
      isPackaged: true,
      productionIndexPath,
      // A packaged process ignores even a malformed override rather than
      // allowing it to alter release startup or renderer trust.
      developmentUrl: "https://attacker.example/",
    });
    expect(packaged).toEqual({ kind: "file", indexPath: productionIndexPath });
    expect(rendererStartUrl(packaged)).toBe("file:///opt/cbb/renderer/index.html");
    expect(createSecureWebPreferences("/opt/cbb/preload.js", packaged.kind === "development").devTools)
      .toBe(false);
    expect(isTrustedRendererUrl("https://attacker.example/", packaged)).toBe(false);
  });

  it("closes file loads to the renderer directory and dev loads to one origin", () => {
    const packaged = { kind: "file", indexPath: "/opt/cbb/renderer/index.html" } as const;
    expect(isTrustedRendererUrl("file:///opt/cbb/renderer/index.html", packaged)).toBe(true);
    expect(isTrustedRendererUrl("file:///opt/cbb/renderer/assets/app.js", packaged)).toBe(true);
    expect(isTrustedRendererUrl("file:///opt/cbb/preload.js", packaged)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com", packaged)).toBe(false);

    const development = { kind: "development", url: "http://127.0.0.1:5173/" } as const;
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/src/main.tsx", development)).toBe(true);
    expect(isTrustedRendererUrl("ws://127.0.0.1:5173/", development)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5174/", development)).toBe(false);
    expect(isTrustedRendererUrl("http://localhost:5173/", development)).toBe(false);
  });
});
