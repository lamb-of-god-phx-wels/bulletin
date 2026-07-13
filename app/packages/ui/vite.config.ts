import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: packageRoot,
  base: "./",
  publicDir: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../../renderer",
    emptyOutDir: true,
    target: "chrome138",
    sourcemap: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/renderer-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
