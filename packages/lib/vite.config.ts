/// <reference types="vite-plus/test" />
import { defineConfig } from "vite-plus";
import dts from "vite-plugin-dts";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    dts() as any,
    {
      name: "copy-llm-prompt",
      apply: "build",
      generateBundle() {
        const srcPath = path.resolve(__dirname, "src/2-llm/llmPrompt.txt");
        const content = fs.readFileSync(srcPath, "utf8");
        this.emitFile({
          type: "asset",
          fileName: "llmPrompt.txt",
          source: content,
        });
      },
    } as any,
    {
      name: "copy-pdf-worker",
      apply: "build",
      generateBundle() {
        try {
          const workerPath = path.resolve(
            __dirname,
            "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
          );
          if (fs.existsSync(workerPath)) {
            const content = fs.readFileSync(workerPath);
            this.emitFile({
              type: "asset",
              fileName: "pdf.worker.mjs",
              source: content,
            });
          }
        } catch (error) {
          console.warn("Could not copy PDF.js worker file:", error);
        }
      },
    } as any,
    {
      name: "copy-poppler-binaries",
      apply: "build",
      generateBundle() {
        try {
          const binPath = path.resolve(__dirname, "bin");
          if (fs.existsSync(binPath)) {
            // Recursively copy bin directory structure
            const copyDir = (srcDir: string, destPrefix: string = "") => {
              const items = fs.readdirSync(srcDir);
              for (const item of items) {
                const srcPath = path.join(srcDir, item);
                const destPath = path.join(destPrefix, item);
                const stat = fs.statSync(srcPath);

                if (stat.isDirectory()) {
                  copyDir(srcPath, destPath);
                } else {
                  const content = fs.readFileSync(srcPath);
                  this.emitFile({
                    type: "asset",
                    fileName: `bin/${destPath}`,
                    source: content,
                  });
                }
              }
            };
            copyDir(binPath);
          }
        } catch (error) {
          console.warn("Could not copy Poppler binaries:", error);
        }
      },
    } as any,
  ],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "PdfToBloom",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "mjs" : "cjs"}`,
    },
    rollupOptions: {
      external: [
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
        "async_hooks",
        "node:async_hooks",
        "sharp", // Add Sharp as external to avoid bundling issues
        // exiftool-vendored ships a platform-specific exiftool binary it locates
        // relative to its own package dir and spawns as a child process; it must
        // stay external so Node resolves it (and its binary) from node_modules.
        "exiftool-vendored",
      ],
    },
    sourcemap: true,
    minify: false,
  },

  test: {
    globals: true,
    environment: "node",
  },
});
