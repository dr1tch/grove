import { defineConfig, loadEnv } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  base: "/grove/app/",
  plugins: [
    {
      // The page CSP allows only GitHub; add the Supabase origin when accounts are configured.
      name: "web-accounts-csp",
      transformIndexHtml(html) {
        const url = loadEnv(mode, process.cwd(), "VITE_").VITE_SUPABASE_URL;
        return url
          ? html.replace(
              "connect-src 'self' https://api.github.com",
              `connect-src 'self' https://api.github.com ${new URL(url).origin}`,
            )
          : html;
      },
    },
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
}));
