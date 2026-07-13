import { defineConfig } from "vitest/config";

/**
 * Vitest 4 project catalog. Each package keeps its own environment and
 * include rules; repository-level contract tests run as a separate project.
 */
export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/services",
      "packages/workers",
      "packages/shell",
      "packages/ui",
      {
        test: {
          name: "app-test",
          include: ["test/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
