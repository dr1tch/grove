import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("./.editor-build", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./editor/main.tsx", import.meta.url)),
      name: "GroveDocument",
      formats: ["iife"],
      fileName: () => "editor.js",
    },
    chunkSizeWarningLimit: 12000,
  },
});
