import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "/grove/app/",
  plugins: [
    {
      name: "web-bundled-fonts",
      enforce: "pre",
      transform(source, id) {
        if (id.endsWith("/src/renderer/styles.css"))
          return source.replace(/@font-face\s*\{[^}]*JetBrainsMono Nerd Font[^}]*\}/g, "");
      },
    },
    react(),
    tailwindcss(),
  ],
  server: { host: "127.0.0.1", strictPort: true },
  build: { outDir: "../../out/web", emptyOutDir: true, chunkSizeWarningLimit: 1800 },
});
