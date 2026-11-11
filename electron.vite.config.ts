import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  main: { build: { externalizeDeps: true } },
  preload: { build: { rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } } } },
  renderer: { plugins: [react(), tailwindcss()], build: { chunkSizeWarningLimit: 1800 } },
});
