import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { conversionApiPlugin } from "./server/apiPlugin";

// Local web app for the BloomBridge Conversion Manager.
// The backend API + live SSE are served by Vite itself via conversionApiPlugin
// (no Express, no separate server); the run engine drives the lib in-process.
//
// Dev (`vp dev`, http://localhost:5180): we resolve @bloombridge/lib to its
// TypeScript SOURCE instead of the built dist, and the API plugin loads its request
// handler through Vite's SSR graph (see conversionApiPlugin). The upshot: editing
// packages/lib is instantly live in the running conversion engine — no `lib build`,
// no stale dist cached in the long-lived dev-server process. Only the server imports
// the lib (the React client talks to it over /api), so aliasing to source can't pull
// lib's Node-only deps into the browser bundle. Gated to `serve`: the production
// build keeps importing the published dist.
const libSource = fileURLToPath(new URL("../lib/src/index.ts", import.meta.url));

export default defineConfig(({ command }) => {
  const dev = command === "serve";
  return {
    plugins: [react(), conversionApiPlugin()],
    resolve: dev ? { alias: { "@bloombridge/lib": libSource } } : {},
    // The aliased path is outside node_modules, so Vite's SSR pipeline transforms the
    // lib (rather than externalizing it) — which is what lets its edits hot-reload.
    ssr: { noExternal: dev ? ["@bloombridge/lib"] : [] },
    server: {
      port: 5180,
      open: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
