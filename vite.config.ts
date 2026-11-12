import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "packages/**/*.test.ts"], environment: "node" },
  lint: { options: { typeAware: true, typeCheck: true } },
  staged: { "*": "vp check --fix" },
  run: {
    tasks: {
      dev: { command: "electron-vite dev", cache: false },
      build: { command: "electron-vite build && node scripts/assets.mjs" },
      typecheck: { command: "tsc --noEmit" },
      package: {
        command:
          "electron-vite build && node scripts/assets.mjs && electron-builder --linux deb AppImage",
        cache: false,
      },
    },
  },
});
