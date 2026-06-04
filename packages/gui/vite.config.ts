import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { conversionApiPlugin } from "./server/apiPlugin";

// Local web app for the PDF → Bloom Conversion Manager.
// The backend API + live SSE are served by Vite itself via conversionApiPlugin
// (no Express, no separate server); the run engine drives the lib in-process.
export default defineConfig({
  plugins: [react(), conversionApiPlugin()],
  server: {
    port: 5180,
    open: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
