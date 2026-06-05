/* Typed client for the Conversion Manager API (served by the Vite plugin). */
import type { Run, Source, Params } from "./types";

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
  notes: (runId: string, notes: string) =>
    sendJson<{ ok: boolean }>(`/api/runs/${runId}/notes`, "POST", { notes }),
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
  preview: (runId: string) =>
    sendJson<{
      ok: boolean;
      dest?: string;
      bloomRunning?: boolean;
      collectionName?: string;
      notified?: boolean;
      broughtToFront?: boolean;
      selected?: boolean;
    }>(`/api/runs/${runId}/preview`, "POST"),
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
