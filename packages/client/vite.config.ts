import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared/src"),
      // Resolve the workspace package directly to its TS source so vite/rollup
      // doesn't have to grok the CJS dist barrel — matches the tsconfig path
      // alias and avoids "X is not exported by .../shared/dist/index.js" errors.
      "@emp-payroll/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      // #127 — Without this, /health/detailed hits the Vite dev server
      // (which 404s) and the System Health page shows "Server unreachable".
      "/health": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      // #219 — Employee documents are served as `/uploads/<file>` by the
      // backend's express.static handler. Without this proxy entry the
      // request hits the Vite dev server (which has no such file) and
      // the doc-view link 404s in dev.
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
