import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shell",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
