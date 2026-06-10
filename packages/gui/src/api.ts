/* Typed client for the Conversion Manager API (served by the Vite plugin). */
import type { Run, Source, Params, MetadataItem, ChecklistMark } from "./types";

/** URL-safe base64 of a (possibly non-ASCII) string — used to key a file path into a path segment. */
const b64url = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function parseOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-json */
  }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data as T;
}
async function getJson<T>(url: string): Promise<T> {
  return parseOrThrow<T>(await fetch(url));
}
async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return parseOrThrow<T>(res);
}

export interface OptionSpec {
  key: string;
  cliFlag: string;
  label: string;
  type: string;
  default: string | number | boolean;
  choices?: { value: string; label: string }[];
  stage: string;
  dependsOn?: Record<string, string | number | boolean>;
  inert?: boolean;
  help: string;
}

export interface ServerSettingsView {
  openrouterKeySet: boolean;
  mistralKeySet: boolean;
  workspace: string;
  defaultCollection: string;
  maxParallel: number;
}

export const api = {
  optionsSchema: () =>
    getJson<{ options: OptionSpec[]; defaults: Record<string, any> }>("/api/options-schema"),
  settings: () => getJson<ServerSettingsView>("/api/settings"),
  saveSettings: (
    patch: Partial<ServerSettingsView> & { openrouterKey?: string; mistralKey?: string },
  ) => sendJson<ServerSettingsView>("/api/settings", "POST", patch),
  collections: () => getJson<{ collections: { path: string; name: string }[] }>("/api/collections"),
  bloomStatus: () =>
    getJson<{
      running: boolean;
      collectionName?: string;
      collectionFolder?: string;
      port?: number;
    }>("/api/bloom-status"),
  cleanup: () =>
    sendJson<{ removedRuns: number; removedPreviews: number; reloaded: boolean }>(
      "/api/cleanup",
      "POST",
    ),
  recentFolders: () => getJson<{ folders: string[] }>("/api/recent-folders"),
  pickFolder: (initial?: string) =>
    sendJson<{ path: string | null }>("/api/pick-folder", "POST", { initial }),
  folder: (path: string) =>
    getJson<{ folder: string; sources: Source[] }>("/api/folder?path=" + encodeURIComponent(path)),
  folderSettings: (path: string) =>
    getJson<Record<string, any>>("/api/folder-settings?path=" + encodeURIComponent(path)),
  saveFolderSettings: (path: string, body: Record<string, any>) =>
    sendJson<Record<string, any>>(
      "/api/folder-settings?path=" + encodeURIComponent(path),
      "PUT",
      body,
    ),
  launch: (
    sources: { id: string; path: string; name: string }[],
    params: Params,
    collection?: string,
  ) => sendJson<{ runIds: string[] }>("/api/runs", "POST", { sources, params, collection }),
  cancel: (runId: string) => sendJson<{ ok: boolean }>(`/api/runs/${runId}/cancel`, "POST"),
  resume: (runId: string) => sendJson<{ runId: string }>(`/api/runs/${runId}/resume`, "POST"),
  remove: (runId: string) => sendJson<{ ok: boolean }>(`/api/runs/${runId}`, "DELETE"),
  rate: (runId: string, rating: "none" | "keeper" | "disapproved") =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/rating`, "POST", { rating }),
  pin: (runId: string, pinned: boolean) =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/pin`, "POST", { pinned }),
  notes: (runId: string, notes: string) =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/notes`, "POST", { notes }),
  // Extracted-metadata checklist: items (with values) + the user's review marks.
  runMetadata: (runId: string) =>
    getJson<{ items: MetadataItem[]; marks: Record<string, ChecklistMark> }>(
      `/api/runs/${runId}/metadata`,
    ),
  setChecklistMark: (runId: string, key: string, mark: ChecklistMark | null) =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/checklist`, "POST", { key, mark }),
  runLog: (runId: string) => getJson<{ lines: string[] }>(`/api/runs/${runId}/log`),
  artifacts: (runId: string) =>
    getJson<{
      tree: { name: string; path: string; kind: string; stage: string }[];
      startable?: string[];
      bookFolder?: string;
    }>(`/api/runs/${runId}/artifacts`),
  osOpen: (path: string, mode: "file" | "folder" | "vscode") =>
    sendJson<{ ok: boolean }>("/api/os-open", "POST", { path, mode }),
  artifactFile: (runId: string, file: string) =>
    getJson<{ content: string | null }>(
      `/api/runs/${runId}/artifact?file=` + encodeURIComponent(file),
    ),
  keeper: (runId: string) =>
    sendJson<{ ok: boolean; dest?: string }>(`/api/runs/${runId}/keeper`, "POST"),
  // mode omitted = probe: if the book is already in the collection the server
  // replies { needsChoice: true } without copying. "replace" overwrites that
  // book (reusing its Bloom id); "new" adds a separate "Check - …" copy.
  preview: (runId: string, mode?: "replace" | "new") =>
    sendJson<{
      ok: boolean;
      dest?: string;
      bloomRunning?: boolean;
      collectionName?: string;
      notified?: boolean;
      broughtToFront?: boolean;
      selected?: boolean;
      needsChoice?: boolean;
      bookName?: string;
      replaced?: boolean;
    }>(`/api/runs/${runId}/preview${mode ? `?mode=${mode}` : ""}`, "POST"),
  // Paired run preview: counts + page geometry, plus URL builders for the
  // per-page source-PDF image and the isolated single Bloom page.
  pagePairs: (runId: string) =>
    getJson<{
      ready: boolean;
      reason?: string;
      /** Which kind of source the left column shows (PDF render vs EPUB illustration). */
      sourceKind?: "pdf" | "epub";
      pdfPages: number;
      bloomPages: number;
      /** Formatted total size of the Bloom book folder (e.g. "2.3 MB"). */
      bloomSize?: string;
      // Explicit per-row alignment: each row renders one source-PDF page and/or one
      // Bloom page (the page's 1-based document index for bookPageUrl). A null on
      // either side means that side has no counterpart (blank/dropped or xMatter).
      rows: { pdfPage: number | null; bloomPage: number | null }[];
      pageSize: string;
      bookReady: boolean;
    }>(`/api/runs/${runId}/page-pairs`),
  pdfPageUrl: (runId: string, page: number, dpi = 150) =>
    `/api/runs/${runId}/pdf-page?page=${page}&dpi=${dpi}`,
  // One source EPUB spine page, served by the resource proxy (its own images/CSS/fonts
  // resolve under this prefix) for the paired preview's left column. /spine/<index>
  // redirects to that spine document; the GUI loads it in an iframe and scales it to fit.
  epubSpineUrl: (runId: string, page: number) => `/api/epub/run/${runId}/spine/${page}`,
  // Same, for an as-yet-unconverted source EPUB (no run): keyed by the file path.
  epubSpineUrlByPath: (epubPath: string, page: number) =>
    `/api/epub/src/${b64url(epubPath)}/spine/${page}`,
  bookPageUrl: (runId: string, page: number, v = 0) =>
    `/api/runs/${runId}/book/__page-${page}.html${v ? `?v=${v}` : ""}`,
  // Master-page reuse: source page → perceptual-hash map, the master book's pages,
  // a thumbnail URL per master page, and recording (or clearing) a mapping.
  runSourceHashes: (runId: string) =>
    getJson<{ hashes: Record<string, string> }>(`/api/runs/${runId}/source-hashes`),
  masterPages: (runId: string) =>
    getJson<{ ready: boolean; masterFolder?: string; pages: { id: string; index: number }[] }>(
      `/api/runs/${runId}/master-pages`,
    ),
  masterPageUrl: (runId: string, index: number, v = 0) =>
    `/api/runs/${runId}/master-page/__page-${index}.html${v ? `?v=${v}` : ""}`,
  saveMasterMapping: (runId: string, sourceHash: string, masterPageId: string | null) =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/master-mapping`, "POST", {
      sourceHash,
      masterPageId,
    }),
  // Ask Bloom to fully process this run's book (writes CSS + browser fix-ups),
  // copied back into the run folder. Blocks until Bloom finishes.
  processBook: (runId: string) =>
    sendJson<{ ok: boolean; processed?: number }>(`/api/runs/${runId}/process`, "POST"),
  // Copy this run's finished book into the matching running Bloom's collection
  // (external/add-book). Fails if no running Bloom has a collection of the book's
  // primary language, or if Bloom isn't on its Collection tab.
  // mode omitted = probe: if the book is already in the collection the server
  // replies { needsChoice: true } without adding. "replace" overwrites that book
  // (reusing its Bloom id); "new" adds it as a separate copy.
  addToCollection: (runId: string, mode?: "replace" | "new") =>
    sendJson<{
      ok: boolean;
      id?: string;
      needsChoice?: boolean;
      bookName?: string;
      replaced?: boolean;
    }>(`/api/runs/${runId}/add-to-collection${mode ? `?mode=${mode}` : ""}`, "POST"),
};

/** Map a GUI rating (mark) to the server rating vocabulary. */
export function markToRating(mark: string): "none" | "keeper" | "disapproved" {
  return mark === "good" ? "keeper" : mark === "bad" ? "disapproved" : "none";
}

/** Subscribe to live run events. Returns an unsubscribe function. */
export function subscribeEvents(handlers: {
  onRunUpdate: (sourceId: string, run: Run) => void;
  onRunDeleted: (sourceId: string, runId: string) => void;
}): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("run-update", (e) => {
    try {
      const { sourceId, run } = JSON.parse((e as MessageEvent).data);
      handlers.onRunUpdate(sourceId, run);
    } catch {
      /* ignore */
    }
  });
  es.addEventListener("run-deleted", (e) => {
    try {
      const { sourceId, runId } = JSON.parse((e as MessageEvent).data);
      handlers.onRunDeleted(sourceId, runId);
    } catch {
      /* ignore */
    }
  });
  return () => es.close();
}

/** Subscribe to a single run's live log lines. Returns an unsubscribe function. */
export function subscribeRunLog(runId: string, onLine: (line: string) => void): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("run-log", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.runId === runId && typeof data.line === "string") onLine(data.line);
    } catch {
      /* ignore */
    }
  });
  return () => es.close();
}
