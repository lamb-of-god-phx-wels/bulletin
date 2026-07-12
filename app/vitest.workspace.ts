import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core",
  "packages/services",
  "packages/workers",
  "packages/shell",
  "packages/ui",
  // integration / guard tests at repo level
  {
    test: {
      name: "app-test",
      include: ["test/**/*.test.ts"],
      environment: "node",
    },
  },
]);
