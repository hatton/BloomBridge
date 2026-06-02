/// <reference types="vite-plus/test" />
import { defineConfig } from "vite-plus";
import { resolve } from "path";
import { fileURLToPath, URL } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    target: "node18",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "pdf-to-bloom-cli",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        // Node.js built-in modules
        "fs",
        "fs/promises",
        "path",
        "os",
        "crypto",
        "child_process",
        "stream",
        "util",
        "url",
        "querystring",
        "http",
        "https",
        "buffer",
        "events",
        "process",
        // Dependencies that should remain external
        "chalk",
        "commander",
        "@pdf-to-bloom/lib",
      ],
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    sourcemap: true,
    minify: false,
  },

  test: {
    globals: true,
    environment: "node",
  },
});
