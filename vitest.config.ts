import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  // StatusBar renders the version badge; mirror vite.config.ts's define.
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    // Mirrors vite.config.ts. Without the katex pin the suite resolved KaTeX
    // through the dual-format path the build no longer uses, so every test —
    // including the math round-trip ones — exercised a different module graph
    // than the shipped bundle.
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      {
        find: /^katex$/,
        replacement: resolve(__dirname, "node_modules/katex/dist/katex.mjs"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
  },
});
