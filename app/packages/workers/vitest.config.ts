import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "workers",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
