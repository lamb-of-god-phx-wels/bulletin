import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "services",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
