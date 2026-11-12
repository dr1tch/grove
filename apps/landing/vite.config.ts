import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/grove/",
  plugins: [react()],
  server: { host: "127.0.0.1", strictPort: true },
  build: { outDir: "../../out/landing", emptyOutDir: true },
});
