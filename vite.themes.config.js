import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: resolve(repoRoot, "tests/themes/gallery"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1422,
    strictPort: true,
  },
  build: {
    outDir: resolve(repoRoot, "dist/themes-gallery"),
    emptyOutDir: true,
  },
});
