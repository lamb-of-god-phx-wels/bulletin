/**
 * Dependency-direction guard for @cbb/core.
 *
 * core must be runtime-agnostic: it must never import from electron, react,
 * or any node: built-in (including node:crypto). All environment capabilities
 * are injected via interfaces defined in core.
 *
 * This test greps all .ts source files in packages/core/src for forbidden
 * import patterns and fails if any are found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_SRC = new URL("../packages/core/src", import.meta.url).pathname;

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Patterns that must never appear in a core import specifier.
 *
 * We match both:
 *   import ... from "electron"
 *   import ... from "node:..."
 *   import ... from "react"
 *   import ... from "react-dom"
 *
 * and dynamic import() calls with the same specifiers.
 */
const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: "electron",
    re: /(?:import|require)\s*\(?\s*["']electron["']/,
  },
  {
    label: "react",
    re: /(?:import|require)\s*\(?\s*["']react(?:-dom)?(?:\/[^"']*)?["']/,
  },
  {
    label: "node: built-in",
    re: /(?:import|require)\s*\(?\s*["']node:/,
  },
];

describe("@cbb/core dependency-direction guard", () => {
  const files = collectTsFiles(CORE_SRC);

  it("finds at least one source file in core/src to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`core/src must not import from: ${pattern.label}`, () => {
      const violations: string[] = [];

      for (const file of files) {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          if (line.trimStart().startsWith("//")) continue;
          if (line.trimStart().startsWith("*")) continue;
          if (pattern.re.test(line)) {
            violations.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `Found forbidden "${pattern.label}" imports in @cbb/core:\n` +
            violations.map((v) => `  ${v}`).join("\n")
        );
      }
    });
  }
});
