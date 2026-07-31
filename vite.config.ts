import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // KaTeX ships dual-format. `src/lib/math.ts` imports it and resolves the
      // ESM build, while the CommonJS `@vscode/markdown-it-katex` requires it
      // and resolves the CJS build — so Rollup compiled BOTH into the entry
      // chunk and evaluated both at boot. Pinning the bare specifier to one
      // file makes them the same module. Anchored so `katex/contrib/*` still
      // resolves through the package's own exports map.
      {
        find: /^katex$/,
        replacement: resolve(__dirname, "node_modules/katex/dist/katex.mjs"),
      },
    ],
  },
});
