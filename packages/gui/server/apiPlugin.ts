/* Vite plugin: serves the Conversion Manager API on the dev server (no Express).
   Adds /api/* middleware to Vite's connect server + an SSE stream at /api/events. */
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  optionsSchema,
  defaultParams,
  getRunningBloomCollection,
  notifyBloomOfBook,
  bringBloomToFront,
  reloadBloomCollection,
  selectBookInBloom,
} from "@pdf-to-bloom/lib";
import { getSettings, saveSettings, redactSettings } from "./settings";
import {
  addClient,
  enqueueRuns,
  enqueueResume,
  cancelRun,
  deleteRun,
  setRating,
  setNotes,
  getFolderTree,
  getRunArtifacts,
  getRunLog,
  readArtifactFile,
  getRunRecord,
  osOpen,
  cleanupRuns,
} from "./engine";

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

const RECENT_PATH = path.join(os.homedir(), ".pdf2bloom", "recent-folders.json");
async function getRecentFolders(): Promise<string[]> {
  try {
    return JSON.parse(await fs.readFile(RECENT_PATH, "utf-8"));
  } catch {
    return [];
  }
}
async function addRecentFolder(folder: string) {
  const list = await getRecentFolders();
  const next = [folder, ...list.filter((f) => f !== folder)].slice(0, 10);
  await fs.mkdir(path.dirname(RECENT_PATH), { recursive: true }).catch(() => {});
  await fs.writeFile(RECENT_PATH, JSON.stringify(next, null, 2)).catch(() => {});
}

/** Discover Bloom collections under the user's Documents/Bloom folders. */
async function listCollections(): Promise<{ path: string; name: string }[]> {
  const home = os.homedir();
  const roots = [
    path.join(home, "OneDrive", "Documents", "Bloom"),
    path.join(home, "Documents", "Bloom"),
  ];
  const out: { path: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      try {
        const files = await fs.readdir(dir);
        if (files.some((f) => f.endsWith(".bloomCollection")) && !seen.has(e.name)) {
          seen.add(e.name);
          out.push({ path: dir, name: e.name });
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

/**
 * Resolve a configured collection value into a real, absolute folder we can copy
 * into — or null if there's no valid target. The "__running__" sentinel (and a
 * missing/"recent" value) resolves to the running Bloom's open collection;
 * anything else must be an absolute path. This guards against ever writing a
 * "preview - …"/keeper copy into a *literal* folder named "__running__" or
 * "recent" under the server's working directory.
 */
function resolveWritableCollection(
  candidate: string | undefined,
  runningBloomFolder?: string,
): string | null {
  if (candidate === "__running__" || candidate === "recent" || !candidate) {
    return runningBloomFolder || null;
  }
  return path.isAbsolute(candidate) ? candidate : runningBloomFolder || null;
}

export function conversionApiPlugin(): Plugin {
  return {
    name: "pdf2bloom-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();
        const u = new URL(url, "http://localhost");
        const p = u.pathname;
        const method = (req.method || "GET").toUpperCase();

        try {
          // --- SSE live event stream ---
          if (p === "/api/events" && method === "GET") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(": connected\n\n");
            const unsub = addClient((event, data) => {
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            });
            const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
            req.on("close", () => {
              clearInterval(heartbeat);
              unsub();
            });
            return;
          }

          if (p === "/api/options-schema" && method === "GET") {
            return send(res, 200, { options: optionsSchema, defaults: defaultParams });
          }

          if (p === "/api/settings" && method === "GET") {
            return send(res, 200, redactSettings(await getSettings()));
          }
          if (p === "/api/settings" && method === "POST") {
            const body = await readBody(req);
            const patch: any = {};
            // Only overwrite keys when a non-empty value is provided.
            if (typeof body.openrouterKey === "string" && body.openrouterKey)
              patch.openrouterKey = body.openrouterKey;
            if (typeof body.mistralKey === "string" && body.mistralKey)
              patch.mistralKey = body.mistralKey;
            if (typeof body.workspace === "string") patch.workspace = body.workspace;
            if (typeof body.defaultCollection === "string")
              patch.defaultCollection = body.defaultCollection;
            if (typeof body.maxParallel === "number") patch.maxParallel = body.maxParallel;
            return send(res, 200, redactSettings(await saveSettings(patch)));
          }

          if (p === "/api/collections" && method === "GET") {
            return send(res, 200, { collections: await listCollections() });
          }

          // Live status of the running Bloom (for the top-bar indicator).
          if (p === "/api/bloom-status" && method === "GET") {
            const b = await getRunningBloomCollection();
            return send(res, 200, {
              running: !!b,
              collectionName: b?.collectionName,
              collectionFolder: b?.collectionFolder,
              port: b?.port,
            });
          }

          if (p === "/api/recent-folders" && method === "GET") {
            return send(res, 200, { folders: await getRecentFolders() });
          }

          // Open a workspace file/folder with the OS (File Explorer / default app / VS Code).
          if (p === "/api/os-open" && method === "POST") {
            const body = await readBody(req);
            const target = String(body.path || "");
            const mode =
              body.mode === "folder" ? "folder" : body.mode === "vscode" ? "vscode" : "file";
            const { workspace } = await getSettings();
            if (!target || !path.resolve(target).startsWith(path.resolve(workspace))) {
              return send(res, 403, { error: "path is outside the workspace" });
            }
            try {
              await osOpen(target, mode);
              return send(res, 200, { ok: true });
            } catch (e: any) {
              return send(res, 500, { error: e?.message || String(e) });
            }
          }

          // Serve a raw artifact file (e.g. an extracted image) from inside the workspace.
          if (p === "/api/artifact-raw" && method === "GET") {
            const fp = u.searchParams.get("p") || "";
            const { workspace } = await getSettings();
            const resolved = path.resolve(fp);
            if (!resolved.startsWith(path.resolve(workspace))) {
              return send(res, 403, { error: "outside workspace" });
            }
            try {
              const buf = await fs.readFile(resolved);
              const ext = path.extname(resolved).toLowerCase();
              const type =
                ext === ".png"
                  ? "image/png"
                  : ext === ".jpg" || ext === ".jpeg"
                    ? "image/jpeg"
                    : "application/octet-stream";
              res.statusCode = 200;
              res.setHeader("Content-Type", type);
              res.end(buf);
            } catch {
              res.statusCode = 404;
              res.end();
            }
            return;
          }

          // Serve a source PDF (for the preview pane). Restricted to PDFs inside a
          // known/recent source folder.
          if (p === "/api/source-pdf" && method === "GET") {
            const fp = u.searchParams.get("path") || "";
            const resolved = path.resolve(fp);
            if (!resolved.toLowerCase().endsWith(".pdf"))
              return send(res, 400, { error: "not a pdf" });
            const recents = await getRecentFolders();
            const allowed = recents.some((r) => resolved.startsWith(path.resolve(r)));
            if (!allowed) return send(res, 403, { error: "pdf is outside known source folders" });
            try {
              const buf = await fs.readFile(resolved);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/pdf");
              res.end(buf);
            } catch {
              res.statusCode = 404;
              res.end();
            }
            return;
          }

          if (p === "/api/folder" && method === "GET") {
            const folder = u.searchParams.get("path");
            if (!folder) return send(res, 400, { error: "path query param required" });
            try {
              const sources = await getFolderTree(folder);
              await addRecentFolder(folder);
              return send(res, 200, { folder, sources });
            } catch (e: any) {
              return send(res, 400, { error: e?.message || String(e) });
            }
          }

          if (p === "/api/folder-settings" && (method === "GET" || method === "PUT")) {
            const folder = u.searchParams.get("path");
            if (!folder) return send(res, 400, { error: "path query param required" });
            const file = path.join(folder, ".pdf2bloom.json");
            if (method === "GET") {
              try {
                return send(res, 200, JSON.parse(await fs.readFile(file, "utf-8")));
              } catch {
                return send(res, 200, {});
              }
            }
            const body = await readBody(req);
            await fs.writeFile(file, JSON.stringify(body, null, 2)).catch(() => {});
            return send(res, 200, body);
          }

          // Cleanup: drop failed/disapproved runs, remove `preview - …` books from
          // the collection(s), and ask Bloom to reload.
          if (p === "/api/cleanup" && method === "POST") {
            const removedRuns = await cleanupRuns();
            const bloom = await getRunningBloomCollection();
            const settings = await getSettings();
            const collections = new Set<string>();
            if (bloom?.collectionFolder) collections.add(bloom.collectionFolder);
            if (settings.defaultCollection && settings.defaultCollection !== "__running__")
              collections.add(settings.defaultCollection);
            let removedPreviews = 0;
            for (const col of collections) {
              try {
                const entries = await fs.readdir(col, { withFileTypes: true });
                for (const e of entries) {
                  if (e.isDirectory() && e.name.toLowerCase().startsWith("preview - ")) {
                    await fs
                      .rm(path.join(col, e.name), { recursive: true, force: true })
                      .catch(() => {});
                    removedPreviews++;
                  }
                }
              } catch {
                /* collection unreadable */
              }
            }
            const reloaded = await reloadBloomCollection(bloom?.port);
            return send(res, 200, { removedRuns, removedPreviews, reloaded });
          }

          if (p === "/api/runs" && method === "POST") {
            const body = await readBody(req);
            const sources = Array.isArray(body.sources) ? body.sources : [];
            if (!sources.length) return send(res, 400, { error: "no sources" });
            const created = await enqueueRuns(sources, body.params || {}, body.collection);
            return send(res, 200, { runIds: created.map((r) => r.id) });
          }

          // /api/runs/:id/<action>
          const m = p.match(/^\/api\/runs\/([^/]+)(?:\/([^/]+))?$/);
          if (m) {
            const runId = decodeURIComponent(m[1]);
            const action = m[2];
            if (!action && method === "DELETE") {
              await deleteRun(runId);
              return send(res, 200, { ok: true });
            }
            if (action === "cancel" && method === "POST") {
              await cancelRun(runId);
              return send(res, 200, { ok: true });
            }
            if (action === "resume" && method === "POST") {
              const rec = await enqueueResume(runId);
              return send(res, 200, { runId: rec.id });
            }
            if (action === "rating" && method === "POST") {
              const body = await readBody(req);
              await setRating(runId, body.rating);
              return send(res, 200, { ok: true });
            }
            if (action === "notes" && method === "POST") {
              const body = await readBody(req);
              await setNotes(runId, String(body.notes ?? ""));
              return send(res, 200, { ok: true });
            }
            if (action === "log" && method === "GET") {
              return send(res, 200, await getRunLog(runId));
            }
            if (action === "artifacts" && method === "GET") {
              return send(res, 200, await getRunArtifacts(runId));
            }
            if (action === "artifact" && method === "GET") {
              const file = u.searchParams.get("file") || "";
              const content = await readArtifactFile(runId, file);
              return send(res, content == null ? 404 : 200, { content });
            }
            if (action === "preview" && method === "POST") {
              const rec = await getRunRecord(runId);
              if (!rec || !rec.bookFolderPath)
                return send(res, 400, {
                  error:
                    "This run hasn't produced a Bloom book yet (run it to the Bloom HTML stage first).",
                });
              // A real Bloom book needs meta.json (+ the .htm). An images-only or
              // mid-pipeline run has neither — copying it would put a bookless folder
              // in the collection that Bloom won't show.
              let isBook = false;
              try {
                await fs.access(path.join(rec.bookFolderPath, "meta.json"));
                isBook = true;
              } catch {
                /* no meta.json */
              }
              if (!isBook)
                return send(res, 400, {
                  error: `This run only reached the "${rec.target}" stage — there's no Bloom book to preview. Run a full conversion (target: Bloom HTML), then preview.`,
                });
              // Prefer the collection Bloom currently has open, so the preview shows
              // where Bloom is looking; fall back to the run's / configured collection.
              const bloom = await getRunningBloomCollection();
              const settings = await getSettings();
              const collection =
                bloom?.collectionFolder ||
                resolveWritableCollection(
                  rec.collection || settings.defaultCollection,
                  bloom?.collectionFolder,
                );
              if (!collection || !path.isAbsolute(collection))
                return send(res, 400, {
                  error:
                    "No Bloom collection to preview into. Open a collection in Bloom, or set a default collection in Settings.",
                });
              const dest = path.join(collection, "preview - " + rec.bookName);
              try {
                await copyDir(rec.bookFolderPath, dest);
              } catch (e: any) {
                return send(res, 500, { error: "copy failed: " + (e?.message || e) });
              }
              const notify = await notifyBloomOfBook(dest);
              const broughtToFront = bloom ? await bringBloomToFront(bloom.port) : false;
              // Final step: ask Bloom to actually select/open the previewed book.
              const selected =
                bloom && notify.bookId ? await selectBookInBloom(notify.bookId, bloom.port) : false;
              return send(res, 200, {
                ok: true,
                dest,
                bloomRunning: !!bloom,
                collectionName: bloom?.collectionName,
                notified: notify.notified,
                broughtToFront,
                selected,
              });
            }
            if (action === "keeper" && method === "POST") {
              const rec = await getRunRecord(runId);
              if (!rec || !rec.bookFolderPath) return send(res, 400, { error: "no book folder" });
              const settings = await getSettings();
              const bloom = await getRunningBloomCollection();
              const collection = resolveWritableCollection(
                rec.collection || settings.defaultCollection,
                bloom?.collectionFolder,
              );
              if (!collection || !path.isAbsolute(collection))
                return send(res, 400, {
                  error:
                    "No target collection. Open a collection in Bloom, or set a default collection in Settings.",
                });
              const dest = path.join(collection, rec.bookName);
              try {
                await copyDir(rec.bookFolderPath, dest);
              } catch (e: any) {
                return send(res, 500, { error: "copy failed: " + (e?.message || e) });
              }
              await setRating(runId, "keeper");
              // Bloom-drive (select/render) is deferred; the book is now in the collection.
              return send(res, 200, { ok: true, dest, bloomDriveDeferred: true });
            }
          }

          return send(res, 404, { error: "not found", path: p });
        } catch (e: any) {
          return send(res, 500, { error: e?.message || String(e) });
        }
      });
    },
  };
}
