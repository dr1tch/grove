import { defineConfig, loadEnv } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => ({
  base: "/grove/app/",
  plugins: [
    {
      // The page CSP allows only GitHub; add Supabase and the Turnstile captcha when configured.
      name: "web-accounts-csp",
      transformIndexHtml(html) {
        const env = loadEnv(mode, process.cwd(), "VITE_");
        if (env.VITE_SUPABASE_URL)
          html = html.replace(
            "connect-src 'self' https://api.github.com",
            `connect-src 'self' https://api.github.com ${new URL(env.VITE_SUPABASE_URL).origin}`,
          );
        if (env.VITE_TURNSTILE_SITE_KEY)
          html = html
            .replace("script-src 'self'", "script-src 'self' https://challenges.cloudflare.com")
            .replace("frame-src blob:", "frame-src blob: https://challenges.cloudflare.com");
        return html;
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
