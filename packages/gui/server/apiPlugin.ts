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
  readBookInstanceId,
  setBookInstanceId,
  bringBloomToFront,
  reloadBloomCollection,
  selectBookInBloom,
  renderPdfPageToImage,
  getPdfPageInfo,
  getEpubPageCount,
  getEpubPageImage,
  getEpubPageRoles,
  getEpubSpineHrefs,
  readEpubEntry,
} from "@bloombridge/lib";
import { getSettings, saveSettings, redactSettings } from "./settings";
import {
  addClient,
  enqueueRuns,
  enqueueResume,
  cancelRun,
  deleteRun,
  setRating,
  setPinned,
  setNotes,
  getFolderTree,
  getRunArtifacts,
  getRunMetadata,
  setChecklistMark,
  getRunLog,
  readArtifactFile,
  getRunRecord,
  osOpen,
  pickFolder,
  cleanupRuns,
  processBookInBloomForRun,
  addFinishedBookToCollectionForRun,
  getSourcePageHashes,
  listMasterPagesForRun,
  resolveMasterPageId,
  getRunMasterFolder,
  saveMasterMappingForRun,
  reapplyMastersForRun,
} from "./engine";

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(json);
}

/** Human-readable byte size, matching the source-file size style ("2.3 MB"). */
function humanSize(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

/** Total size of every file under `dir` (recursively). 0 on any read error. */
async function dirSize(dir: string): Promise<number> {
  let bytes = 0;
  try {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) bytes += await dirSize(p);
      else
        try {
          bytes += (await fs.stat(p)).size;
        } catch {
          /* skip unreadable file */
        }
    }
  } catch {
    /* unreadable dir */
  }
  return bytes;
}

/** Map a file extension to a Content-Type for serving raw book/preview assets. */
function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".css":
      return "text/css";
    case ".htm":
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".json":
      return "application/json";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}

// On-demand rendered source-PDF page images for the paired run preview live here,
// keyed by run id; a new run gets a new id, so cached pages never go stale.
const PREVIEW_CACHE = path.join(os.tmpdir(), "bloombridge-preview");

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

const RECENT_PATH = path.join(os.homedir(), ".bloombridge", "recent-folders.json");
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * A non-colliding folder for a "new copy" send: "Check - <book>", then
 * "Check - <book> (2)", "(3)", … so repeated sends accumulate distinct copies
 * rather than overwriting each other (each gets its own bookInstanceId).
 */
async function firstFreeCopyName(collection: string, bookName: string): Promise<string> {
  const base = "Check - " + bookName;
  let candidate = path.join(collection, base);
  for (let n = 2; await pathExists(candidate); n++) {
    candidate = path.join(collection, `${base} (${n})`);
  }
  return candidate;
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

/**
 * The Conversion Manager API request handler, written as a transport-agnostic connect-style
 * middleware: it handles any `/api/*` request and calls `next()` for everything else. Both the
 * Vite dev plugin below and the standalone Node server ([serve.ts]) mount this same function, so
 * the API behaves identically whether served by Vite (web GUI) or by the desktop sidecar.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
): Promise<unknown> {
  const url = req.url || "";
  if (!url.startsWith("/api/")) return next();
  {
    {
      const u = new URL(url, "http://localhost");
      const p = u.pathname;
      const method = (req.method || "GET").toUpperCase();

      try {
        // --- Lightweight readiness probe (used by the desktop boot page) ---
        if (p === "/api/health" && method === "GET") {
          return send(res, 200, { ok: true });
        }

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

        // Native OS folder-picker dialog. Returns the chosen path, or
        // { path: null } if the user cancelled.
        if (p === "/api/pick-folder" && method === "POST") {
          const body = await readBody(req);
          const initial = typeof body.initial === "string" ? body.initial : undefined;
          const picked = await pickFolder(initial);
          return send(res, 200, { path: picked });
        }

        // Open a workspace file/folder with the OS (File Explorer / default app / VS Code).
        if (p === "/api/os-open" && method === "POST") {
          const body = await readBody(req);
          const target = String(body.path || "");
          const mode =
            body.mode === "folder" ? "folder" : body.mode === "vscode" ? "vscode" : "file";
          const { workspace } = await getSettings();
          const resolved = path.resolve(target);
          const inWorkspace = resolved.startsWith(path.resolve(workspace));
          // Source documents (the PDFs/EPUBs we open with the default app) live in
          // the user's picked source folders, not the workspace — allow those too.
          const recents = await getRecentFolders();
          const inRecent = recents.some((r) => resolved.startsWith(path.resolve(r)));
          if (!target || !(inWorkspace || inRecent)) {
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

        // EPUB resource proxy for the paired preview. Serves a spine document AND its
        // relative images/CSS/fonts by URL, so the page renders faithfully in an iframe
        // (its own fonts + layout intact) — the thing inlining-into-srcdoc could not do.
        //   /api/epub/run/<runId>/spine/<index>  → 302 to that spine doc's resource URL
        //   /api/epub/run/<runId>/<internal/zip/path>  → raw bytes
        //   /api/epub/src/<base64url(path)>/...   → same, for an unconverted source EPUB
        // The document's own relative links (../Images, ../Styles, ../Fonts) resolve under
        // the same prefix because the id is a leading path segment. Path-keyed access is
        // guarded by the same recent-source-folder check the /api/source-* routes use.
        if (p.startsWith("/api/epub/") && method === "GET") {
          const rest = p.slice("/api/epub/".length); // "<scheme>/<id>/<tail…>"
          const schemeSlash = rest.indexOf("/");
          const scheme = rest.slice(0, schemeSlash);
          const afterScheme = rest.slice(schemeSlash + 1);
          const idSlash = afterScheme.indexOf("/");
          const id = decodeURIComponent(idSlash < 0 ? afterScheme : afterScheme.slice(0, idSlash));
          const tail = idSlash < 0 ? "" : afterScheme.slice(idSlash + 1);

          // Resolve the id → an .epub file path.
          let epubPath: string | null = null;
          if (scheme === "run") {
            const rec = await getRunRecord(id);
            if (rec?.sourcePath?.toLowerCase().endsWith(".epub")) epubPath = rec.sourcePath;
          } else if (scheme === "src") {
            try {
              const resolved = path.resolve(Buffer.from(id, "base64url").toString("utf8"));
              const recents = await getRecentFolders();
              if (
                resolved.toLowerCase().endsWith(".epub") &&
                recents.some((r) => resolved.startsWith(path.resolve(r)))
              )
                epubPath = resolved;
            } catch {
              /* fall through to 404 */
            }
          }
          if (!epubPath) {
            res.statusCode = 404;
            return res.end();
          }

          // /spine/<index> → redirect to that spine document's resource URL.
          const spineMatch = tail.match(/^spine\/(\d+)$/);
          if (spineMatch) {
            try {
              const href = getEpubSpineHrefs(epubPath)[Number(spineMatch[1]) - 1];
              if (!href) {
                res.statusCode = 404;
                return res.end();
              }
              const loc = href.split("/").map(encodeURIComponent).join("/");
              res.statusCode = 302;
              res.setHeader("Location", `/api/epub/${scheme}/${encodeURIComponent(id)}/${loc}`);
              return res.end();
            } catch {
              res.statusCode = 404;
              return res.end();
            }
          }

          // Otherwise `tail` is the internal zip path of a single entry.
          try {
            const entry = readEpubEntry(epubPath, decodeURIComponent(tail));
            if (!entry) {
              res.statusCode = 404;
              return res.end();
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", entry.contentType);
            return res.end(entry.buffer);
          } catch {
            res.statusCode = 404;
            return res.end();
          }
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
          const file = path.join(folder, ".bloombridge.json");
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
                const lname = e.name.toLowerCase();
                // "check - …" is the current throwaway-copy prefix; "preview - …"
                // is the legacy one (collections may still hold those).
                if (
                  e.isDirectory() &&
                  (lname.startsWith("check - ") || lname.startsWith("preview - "))
                ) {
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
          // The pipeline now ends with a "Process in Bloom" stage that needs a
          // running Bloom. Gate the launch up front (only when the run will reach
          // that stage) rather than letting every book fail at the end.
          if ((body.params?.target ?? "bloom") === "bloom") {
            const bloom = await getRunningBloomCollection();
            if (!bloom)
              return send(res, 400, {
                error:
                  "Bloom isn't running. Open Bloom with a collection, then start the conversion.",
              });
          }
          const created = await enqueueRuns(sources, body.params || {}, body.collection);
          return send(res, 200, { runIds: created.map((r) => r.id) });
        }

        // Serve a file from a run's Bloom book folder (the .htm, its sibling CSS,
        // and relative images) so the paired-preview iframe renders with styling.
        // Placed before the generic /api/runs/:id/:action matcher, which is
        // anchored and would not match the extra `/book/...` path segment anyway.
        const bookMatch = p.match(/^\/api\/runs\/([^/]+)\/book\/(.*)$/);
        if (bookMatch && method === "GET") {
          const runId = decodeURIComponent(bookMatch[1]);
          const rel = decodeURIComponent(bookMatch[2]);
          const rec = await getRunRecord(runId);
          if (!rec || !rec.bookFolderPath) {
            res.statusCode = 404;
            return res.end();
          }
          const root = path.resolve(rec.bookFolderPath);

          // Synthetic single-page document: the full book .htm with all but the
          // Nth bloom-page hidden. It sits at the same path depth as the real
          // assets, so relative CSS/image URLs resolve without a <base> tag.
          const pageDoc = rel.match(/^__page-(\d+)\.html$/);
          if (pageDoc) {
            const n = Number(pageDoc[1]);
            let htmName: string | undefined;
            try {
              htmName = (await fs.readdir(root)).find((f) => /\.html?$/i.test(f));
            } catch {
              /* unreadable */
            }
            if (!htmName) {
              res.statusCode = 404;
              return res.end();
            }
            let html = await fs.readFile(path.join(root, htmName), "utf-8");
            const inject =
              // Hide every page but the Nth, and the data div (Bloom's basePage.css
              // normally hides #bloomDataDiv; an un-processed book has no such CSS,
              // so it would otherwise leak its data-book fields atop the page).
              `<style>body > .bloom-page{display:none}#bloomDataDiv{display:none!important}` +
              // Render Bloom's page-type label (e.g. "Canvas") as a small pill in
              // the page's top-right corner instead of bare text. Per-type colour
              // is applied inline below; this background is just the fallback.
              `.bloom-page .pageLabel{position:absolute;top:6px;right:6px;left:auto;z-index:1000;` +
              `display:inline-block;width:auto;min-width:0;max-width:none;margin:0;padding:2px 9px;` +
              `background:#5f6368;color:#fff;border-radius:999px;` +
              `font-size:10px;font-weight:600;letter-spacing:.3px;line-height:1.4;` +
              `text-transform:none;box-shadow:0 1px 3px rgba(0,0,0,.3)}` +
              // Bloom appends a trailing colon to xMatter labels (e.g. "Front
              // Cover:") via a ::after pseudo-element — drop it.
              `.bloom-page .pageLabel::after{content:''!important}</style>` +
              `<script>document.addEventListener('DOMContentLoaded',function(){` +
              `var ps=document.querySelectorAll('body > .bloom-page');` +
              `var el=ps[${n - 1}];if(!el)return;el.style.display='block';` +
              // A Canvas page whose canvas holds only the background image (no
              // floating text elements) is really just one big picture, so label
              // it "Full Page Image" rather than repeating the generic "Canvas".
              `var lbl=el.querySelector('.pageLabel');` +
              // Drop any trailing colon Bloom puts after the label text.
              `if(lbl){lbl.textContent=lbl.textContent.replace(/\\s*:\\s*$/,'');` +
              `var cv=el.querySelector('.bloom-canvas');` +
              `if(cv&&lbl.textContent.trim()==='Canvas'){` +
              `var els=cv.querySelectorAll(':scope > .bloom-canvas-element');` +
              `if(els.length===1&&els[0].classList.contains('bloom-backgroundImage'))` +
              `lbl.textContent='Full Page Image';}` +
              // Distinct colours: blue for editable Canvas, magenta for a flattened
              // full-page image; grey fallback for any other Bloom page-type label.
              `var t=lbl.textContent.trim();` +
              `lbl.style.background=t==='Full Page Image'?'#9334e6':t==='Canvas'?'#1a73e8':'#5f6368';}` +
              // A page substituted from the master book carries data-from-master:
              // show a green "From master" pill in the top-left so reuse is obvious.
              `if(el.hasAttribute('data-from-master')){var fm=document.createElement('div');` +
              `fm.textContent='From master';fm.style.cssText='position:absolute;top:6px;left:6px;` +
              `z-index:1000;padding:2px 9px;background:#188038;color:#fff;border-radius:999px;` +
              `font-size:10px;font-weight:600;letter-spacing:.3px;line-height:1.4;` +
              `box-shadow:0 1px 3px rgba(0,0,0,.3)';el.appendChild(fm);}` +
              `});</script>`;
            html = /<\/head>/i.test(html)
              ? html.replace(/<\/head>/i, inject + "</head>")
              : inject + html;
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            return res.end(html);
          }

          const full = path.resolve(root, rel);
          if (!full.startsWith(root)) {
            return send(res, 403, { error: "outside book folder" });
          }
          try {
            const buf = await fs.readFile(full);
            res.statusCode = 200;
            res.setHeader("Content-Type", contentTypeFor(path.extname(full)));
            res.end(buf);
          } catch {
            res.statusCode = 404;
            res.end();
          }
          return;
        }

        // Serve a single master-book page (or its assets) for the master-page
        // picker, mirroring the /book/__page-N.html synthetic-doc above but rooted
        // at the run's master book folder. Placed before the generic :action matcher.
        const masterMatch = p.match(/^\/api\/runs\/([^/]+)\/master-page\/(.*)$/);
        if (masterMatch && method === "GET") {
          const runId = decodeURIComponent(masterMatch[1]);
          const rel = decodeURIComponent(masterMatch[2]);
          const pageDoc = rel.match(/^__page-(\d+)\.html$/);
          if (pageDoc) {
            const n = Number(pageDoc[1]);
            const { masterFolder, id } = await resolveMasterPageId(runId, n);
            if (!masterFolder || !id) {
              res.statusCode = 404;
              return res.end();
            }
            let htmName: string | undefined;
            try {
              htmName = (await fs.readdir(masterFolder)).find((f) => /\.html?$/i.test(f));
            } catch {
              /* unreadable */
            }
            if (!htmName) {
              res.statusCode = 404;
              return res.end();
            }
            let html = await fs.readFile(path.join(masterFolder, htmName), "utf-8");
            // Show only the chosen page (by id, so id-less pages stay hidden), hide
            // the data div, and style the page-type label as a small pill.
            const inject =
              `<style>body > .bloom-page{display:none}#bloomDataDiv{display:none!important}` +
              `.bloom-page .pageLabel{position:absolute;top:6px;right:6px;left:auto;z-index:1000;` +
              `display:inline-block;width:auto;min-width:0;max-width:none;margin:0;padding:2px 9px;` +
              `background:#5f6368;color:#fff;border-radius:999px;font-size:10px;font-weight:600;` +
              `letter-spacing:.3px;line-height:1.4;text-transform:none;box-shadow:0 1px 3px rgba(0,0,0,.3)}` +
              `.bloom-page .pageLabel::after{content:''!important}</style>` +
              `<script>document.addEventListener('DOMContentLoaded',function(){` +
              `var el=document.getElementById(${JSON.stringify(id)});if(!el)return;` +
              `el.style.display='block';var lbl=el.querySelector('.pageLabel');` +
              `if(lbl)lbl.textContent=lbl.textContent.replace(/\\s*:\\s*$/,'');});</script>`;
            html = /<\/head>/i.test(html)
              ? html.replace(/<\/head>/i, inject + "</head>")
              : inject + html;
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            return res.end(html);
          }
          // Raw asset (CSS/image/font) from the master folder.
          const masterFolder = await getRunMasterFolder(runId);
          if (!masterFolder) {
            res.statusCode = 404;
            return res.end();
          }
          const root = path.resolve(masterFolder);
          const full = path.resolve(root, rel);
          if (!full.startsWith(root)) {
            return send(res, 403, { error: "outside master folder" });
          }
          try {
            const buf = await fs.readFile(full);
            res.statusCode = 200;
            res.setHeader("Content-Type", contentTypeFor(path.extname(full)));
            res.end(buf);
          } catch {
            res.statusCode = 404;
            res.end();
          }
          return;
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
            // Same Bloom gate as a fresh launch — a resumed bloom-target run reaches
            // the final Process-in-Bloom stage too.
            const orig = await getRunRecord(runId);
            if ((orig?.target ?? "bloom") === "bloom" && !(await getRunningBloomCollection()))
              return send(res, 400, {
                error:
                  "Bloom isn't running. Open Bloom with a collection, then resume the conversion.",
              });
            const rec = await enqueueResume(runId);
            return send(res, 200, { runId: rec.id });
          }
          if (action === "rating" && method === "POST") {
            const body = await readBody(req);
            await setRating(runId, body.rating);
            return send(res, 200, { ok: true });
          }
          if (action === "pin" && method === "POST") {
            const body = await readBody(req);
            await setPinned(runId, !!body.pinned);
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
          // Extracted-metadata checklist: items (with values) + the user's marks.
          if (action === "metadata" && method === "GET") {
            return send(res, 200, await getRunMetadata(runId));
          }
          // Source page → perceptual-hash map (drives the master-page picker button).
          if (action === "source-hashes" && method === "GET") {
            return send(res, 200, { hashes: await getSourcePageHashes(runId) });
          }
          // The master book's pages, for the picker dialog.
          if (action === "master-pages" && method === "GET") {
            return send(res, 200, await listMasterPagesForRun(runId));
          }
          // Record (or clear, when masterPageId is null) a source-hash → master-page
          // mapping, then re-apply masters so the preview updates immediately.
          if (action === "master-mapping" && method === "POST") {
            const body = await readBody(req);
            const sourceHash = String(body.sourceHash || "");
            const masterPageId = body.masterPageId ? String(body.masterPageId) : null;
            if (!sourceHash) return send(res, 400, { error: "sourceHash required" });
            try {
              await saveMasterMappingForRun(runId, sourceHash, masterPageId);
              await reapplyMastersForRun(runId);
            } catch (e) {
              return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
            }
            return send(res, 200, { ok: true });
          }
          // Set/clear one metadata-review mark.
          if (action === "checklist" && method === "POST") {
            const body = await readBody(req);
            const key = String(body.key || "");
            const mark = body.mark === "up" || body.mark === "down" ? body.mark : null;
            if (!key) return send(res, 400, { error: "key required" });
            await setChecklistMark(runId, key, mark);
            return send(res, 200, { ok: true });
          }
          // Render (and cache) a single source-PDF page as a JPEG for the paired
          // run preview. Reuses the OCR poppler renderer; nothing client-supplied
          // is trusted — the PDF path comes from the run record.
          if (action === "pdf-page" && method === "GET") {
            const page = Math.floor(Number(u.searchParams.get("page") || "0"));
            const dpi = Math.floor(Number(u.searchParams.get("dpi") || "150")) || 150;
            if (!Number.isInteger(page) || page < 1) return send(res, 400, { error: "bad page" });
            const rec = await getRunRecord(runId);
            if (!rec || !rec.sourcePath) {
              res.statusCode = 404;
              return res.end();
            }
            // EPUB source: serve the spine page's illustration directly (no render).
            if (rec.sourcePath.toLowerCase().endsWith(".epub")) {
              try {
                const img = getEpubPageImage(rec.sourcePath, page);
                if (!img) {
                  res.statusCode = 404;
                  return res.end();
                }
                res.statusCode = 200;
                res.setHeader("Content-Type", img.contentType);
                return res.end(img.buffer);
              } catch {
                res.statusCode = 404;
                return res.end();
              }
            }
            const dir = path.join(PREVIEW_CACHE, runId);
            const cachePath = path.join(dir, `pdf-${page}@${dpi}.jpg`);
            try {
              let buf: Buffer;
              try {
                buf = await fs.readFile(cachePath);
              } catch {
                await fs.mkdir(dir, { recursive: true });
                await renderPdfPageToImage(rec.sourcePath, page, cachePath, { dpi });
                buf = await fs.readFile(cachePath);
              }
              res.statusCode = 200;
              res.setHeader("Content-Type", "image/jpeg");
              return res.end(buf);
            } catch {
              // out-of-range page, missing PDF, or render failure
              res.statusCode = 404;
              return res.end();
            }
          }
          // (EPUB spine pages are served faithfully by the /api/epub resource proxy
          // above — the GUI loads them in an iframe, not as a baked HTML blob here.)
          // Counts + page geometry driving the paired run preview.
          if (action === "page-pairs" && method === "GET") {
            const rec = await getRunRecord(runId);
            if (!rec) return send(res, 200, { ready: false, reason: "Run not found." });
            const isEpub = !!rec.sourcePath?.toLowerCase().endsWith(".epub");
            // The source page count is available regardless of run status, so we can
            // show the source column even before (or without) a Bloom book.
            let pdfPages = 0;
            try {
              pdfPages = isEpub
                ? getEpubPageCount(rec.sourcePath!)
                : (await getPdfPageInfo(rec.sourcePath)).pageCount;
            } catch {
              /* source gone/unreadable — leave 0 */
            }

            // Locate the Bloom HTML, if this run got far enough to produce one.
            const root = rec.status === "done" ? rec.bookFolderPath : undefined;
            let htmName: string | undefined;
            if (root) {
              try {
                htmName = (await fs.readdir(root)).find((f) => /\.html?$/i.test(f));
              } catch {
                /* unreadable */
              }
            }

            // No Bloom book yet (still running, failed, or done without HTML): return
            // source-only rows so the client keeps the source column on the left and
            // renders its own placeholder where the Bloom column would be.
            if (!root || !htmName) {
              if (pdfPages === 0)
                return send(res, 200, {
                  ready: false,
                  reason: "This run hasn't produced a Bloom book yet.",
                });
              return send(res, 200, {
                ready: true,
                sourceKind: isEpub ? "epub" : "pdf",
                pdfPages,
                bloomPages: 0,
                rows: Array.from({ length: pdfPages }, (_, i) => ({
                  pdfPage: i + 1,
                  bloomPage: null,
                })),
                pageSize: "A5Portrait",
                bookReady: false,
              });
            }
            const htm = await fs.readFile(path.join(root, htmName), "utf-8");
            // Scan the body's bloom-page divs in document order. `bloomPage` below
            // is this 1-based document index — the same index `__page-N.html` uses
            // (it shows the Nth `body > .bloom-page`). Each page may carry
            // data-source-pdf-page (emitted by html-generator) linking it to its
            // source page; Bloom-regenerated xMatter has none, but does carry
            // data-xmatter-page (frontCover/titlePage/credits/outsideBackCover/…),
            // which lets us align EPUB matter pages by role below.
            const bloom: { docIndex: number; src?: number; xmatter?: string }[] = [];
            const tagRe = /<div\b[^>]*\bbloom-page\b[^>]*>/g;
            let tag: RegExpExecArray | null;
            while ((tag = tagRe.exec(htm))) {
              const sp = tag[0].match(/data-source-pdf-page="(\d+)"/);
              const xm = tag[0].match(/data-xmatter-page="([^"]+)"/);
              bloom.push({
                docIndex: bloom.length + 1,
                src: sp ? Number(sp[1]) : undefined,
                xmatter: xm ? xm[1] : undefined,
              });
            }
            const bloomPages = bloom.length;
            const sizeMatch = htm.match(
              /class="[^"]*\b(A3|A4|A5|A6|Letter|Legal|Device16x9|HalfLetter|QuarterLetter)(Portrait|Landscape)\b/,
            );
            const pageSize = sizeMatch ? sizeMatch[1] + sizeMatch[2] : "A5Portrait";
            let bookReady = false;
            try {
              await fs.access(path.join(root, "basePage.css"));
              bookReady = true;
            } catch {
              /* CSS not written yet */
            }
            // Folder total (HTML + images + CSS), for the Bloom column's size sub-label.
            const bloomSize = humanSize(await dirSize(root));

            // Align the two columns. When Bloom pages carry source-page numbers we
            // merge by them (so a blank/dropped source page shows a PDF-only row and
            // a Bloom-added page shows a Bloom-only row, instead of shifting
            // everything after it). Without that mapping (older books, or Bloom
            // stripped the attribute on import) we fall back to naïve index pairing.
            const rows: { pdfPage: number | null; bloomPage: number | null }[] = [];
            const haveMapping = pdfPages > 0 && bloom.some((b) => b.src !== undefined);
            // EPUB: Bloom rebuilds the cover/title/credits/back pages as its own
            // xMatter and strips their source-page link, so a pure source-page merge
            // orphans both sides' matter into mismatched single-column rows. Instead
            // walk the Bloom pages in document order and, for each, find its EPUB
            // spine page — by source-page for content, or by role for xMatter — so
            // e.g. Bloom's credits page lines up with the EPUB's (trailing) copyright
            // spine page. Any spine page never matched is appended as a source-only
            // row so nothing is silently dropped.
            const epubRoleAlign = isEpub && haveMapping;
            if (epubRoleAlign) {
              let roles: { index: number; role: string }[] = [];
              try {
                roles = getEpubPageRoles(rec.sourcePath!);
              } catch {
                /* source gone — leave empty; falls through to source-only rows */
              }
              const XMATTER_TO_ROLE: Record<string, string> = {
                frontCover: "front-cover",
                titlePage: "title",
                credits: "credits",
                outsideBackCover: "back-cover",
              };
              const byRole = (role: string) => roles.find((r) => r.role === role)?.index ?? null;
              // The EPUB's front cover is its first spine page. LFA/Vanuatu books NAME it
              // (`cover.*` → role front-cover), so byRole finds it; StoryWeaver books name
              // their pages 1..N, so NO page is classified front-cover even though spine page
              // 1 IS the cover. When the role is missing, fall back to spine page 1 — unless a
              // Bloom CONTENT page already claims page 1 as its source (a reflowable novel's
              // first spine page is real content, not a cover, and is paired by source-page
              // instead). This keeps the two covers paired side by side even though the EPUB
              // cover art and Bloom's regenerated cover look very different.
              const bloomClaimsPage1 = bloom.some((b) => b.src === 1);
              const frontCoverEpubPage =
                byRole("front-cover") ?? (roles.length > 0 && !bloomClaimsPage1 ? 1 : null);
              const consumed = new Set<number>();
              for (const b of bloom) {
                let epubPage: number | null = null;
                if (b.src !== undefined) epubPage = b.src;
                else if (b.xmatter === "frontCover") epubPage = frontCoverEpubPage;
                else if (b.xmatter && XMATTER_TO_ROLE[b.xmatter])
                  epubPage = byRole(XMATTER_TO_ROLE[b.xmatter]);
                if (epubPage !== null) consumed.add(epubPage);
                rows.push({ pdfPage: epubPage, bloomPage: b.docIndex });
              }
              for (const r of roles)
                if (!consumed.has(r.index)) rows.push({ pdfPage: r.index, bloomPage: null });
            } else if (!haveMapping) {
              const n = Math.max(pdfPages, bloomPages);
              for (let i = 1; i <= n; i++) {
                rows.push({
                  pdfPage: i <= pdfPages ? i : null,
                  bloomPage: i <= bloomPages ? i : null,
                });
              }
            } else {
              let si = 1; // source-PDF page cursor
              let bi = 0; // bloom-page cursor
              while (si <= pdfPages || bi < bloom.length) {
                const b = bi < bloom.length ? bloom[bi] : undefined;
                if (b && b.src === undefined) {
                  // Bloom-added page (cover/title/credits) with no source page.
                  rows.push({ pdfPage: null, bloomPage: b.docIndex });
                  bi++;
                } else if (b && b.src !== undefined && b.src < si) {
                  // A source ref we've already passed (e.g. two pages claim it).
                  rows.push({ pdfPage: null, bloomPage: b.docIndex });
                  bi++;
                } else if (si <= pdfPages && (b === undefined || (b.src as number) > si)) {
                  // Source page with no Bloom page — blank/dropped. Bloom side empty.
                  rows.push({ pdfPage: si, bloomPage: null });
                  si++;
                } else if (b && b.src === si) {
                  rows.push({ pdfPage: si <= pdfPages ? si : null, bloomPage: b.docIndex });
                  if (si <= pdfPages) si++;
                  bi++;
                } else if (b) {
                  rows.push({ pdfPage: null, bloomPage: b.docIndex });
                  bi++;
                } else {
                  break;
                }
              }
            }

            return send(res, 200, {
              ready: true,
              sourceKind: isEpub ? "epub" : "pdf",
              pdfPages,
              bloomPages,
              bloomSize,
              rows,
              pageSize,
              bookReady,
            });
          }
          // Ask the running Bloom to fully process this run's book (apply the
          // browser-only fix-ups + write the CSS), then copy the styled result
          // back into the run's workspace folder so the paired preview renders
          // it. process-book operates on a book in Bloom's open collection, so
          // we stage a copy there first (same as Preview), notify/select it, run
          // the processing, then copy the rewritten files back.
          if (action === "process" && method === "POST") {
            const rec = await getRunRecord(runId);
            if (!rec)
              return send(res, 400, { error: "This run hasn't produced a Bloom book yet." });
            try {
              const result = await processBookInBloomForRun(rec);
              return send(res, 200, { ok: true, processed: result.processed });
            } catch (e: any) {
              return send(res, e?.httpStatus || 500, {
                error: e?.message || "Bloom couldn't process the book.",
              });
            }
          }
          // Copy this run's finished book into a running Bloom's open collection
          // (whose L1 matches the book's L1) via external/add-book.
          if (action === "add-to-collection" && method === "POST") {
            const rec = await getRunRecord(runId);
            if (!rec)
              return send(res, 400, { error: "This run hasn't produced a Bloom book yet." });
            try {
              const mode = u.searchParams.get("mode"); // null | "replace" | "new"
              const result = await addFinishedBookToCollectionForRun(
                rec,
                mode === "replace" || mode === "new" ? mode : undefined,
              );
              if (result.needsChoice)
                return send(res, 200, { ok: true, needsChoice: true, bookName: rec.bookName });
              return send(res, 200, { ok: true, id: result.id, replaced: result.replaced });
            } catch (e: any) {
              return send(res, e?.httpStatus || 500, {
                error: e?.message || "Bloom couldn't add the book to its collection.",
              });
            }
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
            // The collection may already hold this book under its canonical
            // (un-prefixed) folder name — e.g. a copy the user previously kept or
            // uploaded to Bloom Library, whose bookInstanceId matters. Without an
            // explicit mode, surface that so the GUI can ask whether to replace it
            // (reusing its id) or add this conversion as a separate copy.
            const mode = u.searchParams.get("mode"); // null | "replace" | "new"
            const canonical = path.join(collection, rec.bookName);
            const canonicalExists = await pathExists(path.join(canonical, "meta.json"));
            if (!mode && canonicalExists) {
              return send(res, 200, { ok: true, needsChoice: true, bookName: rec.bookName });
            }
            // "replace" overwrites the canonical book and reuses its id; otherwise
            // (explicit "new", or default when nothing's there) we add a fresh copy.
            const replace = mode === "replace";
            let dest: string;
            let reuseId: string | undefined;
            if (replace) {
              dest = canonical;
              reuseId = await readBookInstanceId(canonical);
              // Clear the old folder first so stale files (renamed images, etc.)
              // from the previous book don't linger alongside the new ones.
              await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
            } else {
              dest = await firstFreeCopyName(collection, rec.bookName);
            }
            try {
              await copyDir(rec.bookFolderPath, dest);
            } catch (e: any) {
              return send(res, 500, { error: "copy failed: " + (e?.message || e) });
            }
            // Reuse the replaced book's id (so a Bloom Library re-upload updates the
            // same entry), or mint a fresh id for a separate copy (so Bloom treats it
            // as a distinct book rather than a duplicate of the run's source folder).
            await setBookInstanceId(dest, replace ? reuseId : undefined).catch(() => {});
            const notify = await notifyBloomOfBook(dest);
            const broughtToFront = bloom ? await bringBloomToFront(bloom.port) : false;
            // Final step: ask Bloom to actually select/open the previewed book.
            const selected =
              bloom && notify.bookId ? await selectBookInBloom(notify.bookId, bloom.port) : false;
            return send(res, 200, {
              ok: true,
              dest,
              replaced: replace,
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
    }
  }
}

/* Vite plugin: mounts the shared API handler on the dev server's connect middleware
   stack (+ the SSE stream at /api/events). Used by the web GUI (`vp dev`). */
export function conversionApiPlugin(): Plugin {
  return {
    name: "bloombridge-api",
    configureServer(server: ViteDevServer) {
      // Load the handler through Vite's SSR graph rather than using the statically
      // imported `handleApiRequest` above. That static import resolved @bloombridge/lib
      // to the built dist at config-load time and Node caches it for the life of this
      // process — so a lib edit would never take effect without a restart. Going through
      // ssrLoadModule means the handler (and its lib import, aliased to source in
      // vite.config) is re-evaluated whenever the lib source changes: editing the
      // conversion engine is live. Vite caches the module between edits, so this only
      // re-runs when something actually changed.
      server.middlewares.use(async (req, res, next) => {
        try {
          const mod = (await server.ssrLoadModule("/server/apiPlugin.ts")) as {
            handleApiRequest: typeof handleApiRequest;
          };
          await mod.handleApiRequest(req, res, next);
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          next(err);
        }
      });
    },
  };
}
