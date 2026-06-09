/* App — talks to the local API (served by Vite) and live-updates over SSE. */
import React, { useState, useEffect } from "react";
import { Icon } from "./lib/icons";
import { IconBtn } from "./components/primitives";
import { CenterTable } from "./components/table";
import { SourcePanel, BatchPane, RunSelectionPane, PdfViewerPane } from "./components/panels";
import {
  RunConfig,
  CompareModal,
  SettingsModal,
  ConfirmModal,
  ConvSettingsModal,
  RunDetailsModal,
} from "./components/modals";
import { useTweaks } from "./components/devPanel";
import { api, subscribeEvents, markToRating, type ServerSettingsView } from "./api";
import type { Focus, Mark, Params, Run, Settings, Source } from "./types";

const FALLBACK_PARAMS: Params = {
  ocrMethod: "gpt",
  model: "google/gemini-3.1-pro-preview",
  visionFormatting: true,
  visionModel: "google/gemini-3.1-pro-preview",
  coverMode: "auto",
  complexBecomesImage: "busy",
  target: "bloom",
};

const PARAM_KEYS: (keyof Params)[] = [
  "ocrMethod",
  "model",
  "visionFormatting",
  "visionModel",
  "coverMode",
  "complexBecomesImage",
  "target",
];

const TWEAK_DEFAULTS = {
  dark: false,
  accentHue: 256,
  density: "regular",
  metricFont: "mono",
  configMode: "modal",
  demoState: "live",
};

function upsertRun(runs: Run[], run: Run): Run[] {
  const idx = runs.findIndex((r) => r.id === run.id);
  if (idx === -1) return [run, ...runs];
  const next = runs.slice();
  next[idx] = run;
  return next;
}

export function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [folder, setFolder] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [collections, setCollections] = useState<{ path: string; name: string }[]>([]);
  const [defaults, setDefaults] = useState<Params>(FALLBACK_PARAMS);
  const [maxParallel, setMaxParallel] = useState(2);
  const [defaultCollection, setDefaultCollection] = useState("__running__");
  // Target collection for launches/promote: "__running__" (the running Bloom's
  // open collection), a real path, or "" (no collection).
  const [launchCollection, setLaunchCollection] = useState("__running__");
  const [serverSettings, setServerSettings] = useState<ServerSettingsView | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<Focus>(null);
  const [checkedPdfs, setCheckedPdfs] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [leftOpen, setLeftOpen] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("status");
  const [sortDir, setSortDir] = useState("desc");
  const [modal, setModal] = useState<any>(null);
  const [pdfWidth, setPdfWidth] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("bloombridge.pdfPane.width")) || 420;
    } catch {
      return 420;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("bloombridge.pdfPane.width", String(pdfWidth));
    } catch {
      /* ignore */
    }
  }, [pdfWidth]);
  const [bloom, setBloom] = useState<{
    running: boolean;
    collectionName?: string;
    collectionFolder?: string;
  }>({
    running: false,
  });
  const [toast, setToast] = useState<{ kind: "info" | "ok" | "error"; msg: string } | null>(null);
  const showToast = (kind: "info" | "ok" | "error", msg: string, ms = 5000) => {
    setToast({ kind, msg });
    if (ms) window.setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), ms);
  };

  const onSortClick = (key: string) => {
    if (key === sort) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  // ---- initial load + SSE ----
  useEffect(() => {
    api
      .optionsSchema()
      .then((r) => {
        const picked: any = {};
        for (const k of PARAM_KEYS) if (k in r.defaults) picked[k] = r.defaults[k];
        setDefaults({ ...FALLBACK_PARAMS, ...picked });
      })
      .catch(() => {});
    api
      .recentFolders()
      .then((r) => setRecentFolders(r.folders))
      .catch(() => {});
    api
      .collections()
      .then((r) => setCollections(r.collections))
      .catch(() => {});
    api
      .settings()
      .then((s) => {
        setServerSettings(s);
        setMaxParallel(s.maxParallel);
        setDefaultCollection(s.defaultCollection);
        if (s.defaultCollection) setLaunchCollection(s.defaultCollection);
        // The pipeline can't run without an OpenRouter key. If it's missing,
        // prompt for it immediately. (Mistral is optional — only --ocr mistral.)
        if (!s.openrouterKeySet) {
          setModal({
            type: "settings",
            draft: {
              openrouterKey: "",
              mistralKey: "",
              workspace: s.workspace || "",
              collection: s.defaultCollection,
              preset: "",
              parallelism: s.maxParallel,
            },
          });
        }
      })
      .catch(() => {});

    // Restore the last-opened folder across refreshes.
    let savedFolder: string | null = null;
    try {
      savedFolder = localStorage.getItem("bloombridge.folder");
    } catch {
      /* ignore */
    }
    if (savedFolder) {
      api
        .folder(savedFolder)
        .then((r) => {
          setFolder(r.folder);
          setSources(r.sources);
          setLeftOpen(false);
        })
        .catch(() => {});
    }

    const pollBloom = () =>
      api
        .bloomStatus()
        .then(setBloom)
        .catch(() => setBloom({ running: false }));
    pollBloom();
    const bloomTimer = window.setInterval(pollBloom, 5000);

    const unsub = subscribeEvents({
      onRunUpdate: (sourceId, run) =>
        setSources((ss) =>
          ss.map((s) => (s.id === sourceId ? { ...s, runs: upsertRun(s.runs, run) } : s)),
        ),
      onRunDeleted: (sourceId, runId) =>
        setSources((ss) =>
          ss.map((s) =>
            s.id === sourceId ? { ...s, runs: s.runs.filter((r) => r.id !== runId) } : s,
          ),
        ),
    });
    return () => {
      clearInterval(bloomTimer);
      unsub();
    };
  }, []);

  // apply theme/density/accent
  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-density", t.density === "regular" ? "" : t.density);
    r.style.setProperty("--accent-h", String(t.accentHue));
    r.style.setProperty(
      "--font-metric",
      t.metricFont === "mono" ? "var(--font-mono)" : "var(--font-ui)",
    );
  }, [t.dark, t.density, t.accentHue, t.metricFont]);

  const hasFolder = !!folder;

  const pickFolder = async (p: string) => {
    try {
      const r = await api.folder(p);
      setFolder(r.folder);
      setSources(r.sources);
      setLeftOpen(false);
      try {
        localStorage.setItem("bloombridge.folder", r.folder);
      } catch {
        /* ignore */
      }
      api
        .recentFolders()
        .then((rf) => setRecentFolders(rf.folders))
        .catch(() => {});
    } catch (e: any) {
      setModal({
        type: "confirm",
        title: "Couldn't open folder",
        message: e?.message || String(e),
        confirmLabel: "OK",
      });
    }
  };
  const rescan = () => folder && pickFolder(folder);

  // ---- focus / selection ----
  const focusedSource = sources.find((s) => s.id === (focus ? focus.sourceId : null));
  const focusedRun =
    focus && focus.type === "run" && focusedSource
      ? focusedSource.runs.find((r) => r.id === focus.runId)
      : null;

  // Conversion settings the preview pane's "Convert to Bloom" button and the gear
  // settings modal both edit. Seeded from the focused book's most-recent run (or
  // the defaults) and reset only when the focused book changes — so editing in the
  // settings modal isn't clobbered by live run updates.
  const [convParams, setConvParams] = useState<Params>(defaults);
  useEffect(() => {
    const seed = focusedSource?.runs[0]?.params || defaults;
    setConvParams({ ...seed });
    // Only when the focused book changes (not on every run update).
  }, [focus?.sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectRun = (sid: string, rid: string) => {
    setFocus({ type: "run", sourceId: sid, runId: rid });
  };
  const onSelectPdf = (sid: string) => {
    setFocus({ type: "pdf", sourceId: sid });
  };
  // Open the run-details modal (log / artifacts / metrics / notes) for a run.
  const openRunDetails = (sid: string, rid: string) =>
    setModal({ type: "runDetails", sourceId: sid, runId: rid });
  const onToggleExpand = (id: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allExpanded =
    sources.length > 0 && sources.every((s) => expanded.has(s.id) || !s.runs.length);
  const onExpandAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(sources.map((s) => s.id)));

  const onCheck = (rid: string, v: boolean) => {
    if (v) {
      if (checkedPdfs.size) setCheckedPdfs(new Set());
    }
    setChecked((c) => {
      const n = new Set(c);
      v ? n.add(rid) : n.delete(rid);
      return n;
    });
  };
  const onCheckMany = (ids: string[], v: boolean) => {
    if (v) {
      if (checkedPdfs.size) setCheckedPdfs(new Set());
    }
    setChecked((c) => {
      const n = new Set(c);
      ids.forEach((id) => (v ? n.add(id) : n.delete(id)));
      return n;
    });
  };
  const onCheckPdf = (sid: string, v: boolean) => {
    if (v) {
      if (checked.size) setChecked(new Set());
    }
    setCheckedPdfs((c) => {
      const n = new Set(c);
      v ? n.add(sid) : n.delete(sid);
      return n;
    });
  };

  // ---- launching ----
  // "recent" = use the running Bloom's open collection (like --collection recent);
  // a path = that collection; "" = no collection (no language hints/master).
  const collectionForLaunch = () => (launchCollection ? launchCollection : undefined);
  const launch = async (srcs: Source[], params: Params) => {
    const payload = srcs
      .filter((s) => s.path)
      .map((s) => ({ id: s.id, path: s.path!, name: s.name }));
    if (!payload.length) return;
    setExpanded((e) => {
      const n = new Set(e);
      payload.forEach((p) => n.add(p.id));
      return n;
    });
    try {
      const r = await api.launch(payload, params, collectionForLaunch());
      if (payload.length === 1 && r.runIds[0]) onSelectRun(payload[0].id, r.runIds[0]);
    } catch (e: any) {
      setModal({
        type: "confirm",
        title: "Launch failed",
        message: e?.message || String(e),
        confirmLabel: "OK",
      });
    }
  };
  const quickStart = (source: Source, params: Params) => launch([source], params);
  const batchRun = (params: Params) => {
    const sel = sources.filter((s) => checkedPdfs.has(s.id));
    launch(sel, params);
    setCheckedPdfs(new Set());
  };

  const onConfigRun = (source: Source, run?: Run) => setModal({ type: "config", source, run });
  const onConfirmRun = ({ params }: { params: Params; start: string }) => {
    const src: Source = modal.source;
    launch([src], params);
    setModal(null);
  };

  // ---- curation ----
  const onMark = (_sid: string, rid: string, mark: Mark) => {
    api.rate(rid, markToRating(mark)).catch(() => {});
  };
  const onPin = (_sid: string, rid: string, pinned: boolean) => {
    api.pin(rid, pinned).catch(() => {});
  };
  const onNotes = (sid: string, rid: string, patch: Partial<Run>) => {
    // optimistic local update for responsive typing
    setSources((ss) =>
      ss.map((s) =>
        s.id === sid
          ? { ...s, runs: s.runs.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }
          : s,
      ),
    );
    if (typeof patch.notes === "string") api.notes(rid, patch.notes).catch(() => {});
  };
  const onCancelRun = (_sid: string, rid: string) => {
    api.cancel(rid).catch(() => {});
  };
  const onResumeRun = (_s: Source, run: Run) => {
    api
      .resume(run.id)
      .then(() => showToast("ok", "Resuming from the last successful stage…"))
      .catch((e) => showToast("error", e?.message || "Could not resume this run."));
  };
  const onDeleteRun = (_sid: string, rid: string) =>
    setModal({
      type: "confirm",
      title: "Delete run?",
      message: "This run and its cached artifacts will be permanently removed.",
      confirmLabel: "Delete run",
      danger: true,
      onConfirm: () => {
        api.remove(rid).catch(() => {});
        if (focus && (focus as any).runId === rid)
          setFocus(focusedSource ? { type: "pdf", sourceId: focusedSource.id } : null);
        setModal(null);
      },
    });

  const checkedCount = checked.size;
  const bulkMark = (mark: Mark) => {
    checked.forEach((rid) => api.rate(rid, markToRating(mark)).catch(() => {}));
  };
  const bulkCancel = () => {
    checked.forEach((rid) => api.cancel(rid).catch(() => {}));
    setChecked(new Set());
  };
  const bulkRun = () => {
    sources.forEach((s) =>
      s.runs.forEach((r) => {
        if (checked.has(r.id)) launch([s], { ...FALLBACK_PARAMS, ...(r.params as Params) });
      }),
    );
    setChecked(new Set());
  };
  const bulkDelete = () =>
    setModal({
      type: "confirm",
      title: "Delete " + checkedCount + " run" + (checkedCount > 1 ? "s" : "") + "?",
      message: "The selected runs and their cached artifacts will be permanently removed.",
      confirmLabel: "Delete runs",
      danger: true,
      onConfirm: () => {
        checked.forEach((rid) => api.remove(rid).catch(() => {}));
        setChecked(new Set());
        setModal(null);
      },
    });

  // ---- cleanup: drop failed/disapproved runs + previews, reload Bloom ----
  const onCleanup = () =>
    setModal({
      type: "confirm",
      title: "Clean up?",
      message:
        "This removes all failed and disapproved runs (and their folders), deletes 'preview - …' books from the Bloom collection, and asks Bloom to reload. Keepers and good runs are kept.",
      confirmLabel: "Clean up",
      danger: true,
      onConfirm: async () => {
        setModal(null);
        showToast("info", "Cleaning up…", 0);
        try {
          const r = await api.cleanup();
          showToast(
            "ok",
            `Removed ${r.removedRuns} run(s) and ${r.removedPreviews} preview(s)${r.reloaded ? "; reloaded Bloom" : ""}.`,
          );
        } catch (e: any) {
          showToast("error", e?.message || String(e), 8000);
        }
      },
    });

  // ---- preview: copy into the open Bloom collection + bring Bloom to front ----
  const onPreview = async (run: Run) => {
    showToast("info", "Sending to Bloom…", 0);
    try {
      const r = await api.preview(run.id);
      if (r.bloomRunning) {
        showToast(
          "ok",
          `Opened in Bloom${r.collectionName ? ` (${r.collectionName})` : ""}${r.broughtToFront ? " — brought to front" : ""}.`,
        );
      } else {
        showToast("ok", "Copied into your collection. Start Bloom to view it (it isn't running).");
      }
    } catch (e: any) {
      showToast("error", e?.message || String(e), 8000);
    }
  };

  // ---- settings ----
  const openSettings = () => {
    const draft: Settings = {
      openrouterKey: "",
      mistralKey: "",
      workspace: serverSettings?.workspace || "",
      collection: defaultCollection,
      preset: "",
      parallelism: maxParallel,
    };
    setModal({ type: "settings", draft });
  };
  const saveSettingsModal = async (draft: Settings) => {
    const patch: any = {
      workspace: draft.workspace,
      defaultCollection: draft.collection,
      maxParallel: draft.parallelism,
    };
    if (draft.openrouterKey) patch.openrouterKey = draft.openrouterKey;
    if (draft.mistralKey) patch.mistralKey = draft.mistralKey;
    try {
      const s = await api.saveSettings(patch);
      setServerSettings(s);
      setMaxParallel(s.maxParallel);
      setDefaultCollection(s.defaultCollection);
    } catch {
      /* ignore */
    }
    setModal(null);
  };

  const runningCount = sources.reduce(
    (a, s) => a + s.runs.filter((r) => r.status === "running").length,
    0,
  );
  const queuedCount = sources.reduce(
    (a, s) => a + s.runs.filter((r) => r.status === "queued").length,
    0,
  );
  const batchActive = checkedPdfs.size >= 1;
  const multiSelected = checkedPdfs.size > 1;
  // The run the always-open preview pane shows: an explicitly-focused run, else
  // the focused book's most-recent run — so a user can ignore the fact that we
  // store multiple runs and just work from the top level of the tree.
  const previewRun = multiSelected
    ? null
    : focus && focus.type === "run"
      ? focusedRun
      : focusedSource
        ? focusedSource.runs[0] || null
        : null;
  const previewRunId = previewRun ? previewRun.id : undefined;
  const previewMode: "run" | "pdf" = previewRunId ? "run" : "pdf";
  // A single book is in focus (not a batch / multi-run selection) → the preview
  // pane's Run-conversion / settings / details controls apply.
  const showPreviewActions = !batchActive && checked.size === 0 && !!focusedSource;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <TopBar
        dark={t.dark}
        onToggleTheme={() => setTweak("dark", !t.dark)}
        onSettings={openSettings}
      />

      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
        {!hasFolder || leftOpen ? (
          <SourcePanel
            folder={folder}
            bookCount={sources.length}
            recentFolders={recentFolders}
            onPick={pickFolder}
            onRescan={rescan}
            onCollapse={hasFolder ? () => setLeftOpen(false) : null}
          />
        ) : (
          <LeftRail
            folder={folder!}
            bookCount={sources.length}
            onExpand={() => setLeftOpen(true)}
          />
        )}

        {hasFolder ? (
          <CenterTable
            sources={sources}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            selectedRunId={focus && focus.type === "run" ? focus.runId : null}
            onSelectRun={onSelectRun}
            onSelectPdf={onSelectPdf}
            focusPdfId={!batchActive && focus && focus.type === "pdf" ? focus.sourceId : null}
            checkedPdfs={checkedPdfs}
            onCheckPdf={onCheckPdf}
            checked={checked}
            onCheck={onCheck}
            onCheckMany={onCheckMany}
            onCheckManyPdfs={(ids, v) => {
              if (v) {
                if (checked.size) setChecked(new Set());
              }
              setCheckedPdfs((c) => {
                const n = new Set(c);
                ids.forEach((id) => (v ? n.add(id) : n.delete(id)));
                return n;
              });
            }}
            onMark={onMark}
            onPin={onPin}
            onCancelRun={onCancelRun}
            onPreview={onPreview}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            sort={sort}
            sortDir={sortDir}
            onSortClick={onSortClick}
            onCleanup={onCleanup}
            onConfigRun={onConfigRun}
            onOpenRunDetails={openRunDetails}
            onDeleteRun={onDeleteRun}
            onExpandAll={onExpandAll}
            allExpanded={allExpanded}
            defaults={defaults}
          />
        ) : (
          <EmptyWorkspace recentFolders={recentFolders} onPick={pickFolder} />
        )}

        {/* Batch / multi-run selection still get a dedicated middle pane; single
            selections are handled by the always-open preview pane on the right. */}
        {batchActive ? (
          <BatchPane
            count={checkedPdfs.size}
            parallelism={maxParallel}
            defaultParams={defaults}
            onClose={() => setCheckedPdfs(new Set())}
            onClear={() => setCheckedPdfs(new Set())}
            onRun={batchRun}
          />
        ) : checked.size >= 1 ? (
          <RunSelectionPane
            count={checked.size}
            onClose={() => setChecked(new Set())}
            onClear={() => setChecked(new Set())}
            onDelete={bulkDelete}
            onApprove={() => bulkMark("good")}
            onDisapprove={() => bulkMark("bad")}
            onCancel={bulkCancel}
            onRun={bulkRun}
          />
        ) : null}

        {/* The preview pane is always open. It hosts Run conversion + settings +
            run-details, and compares the source against the most-recent run. */}
        <PdfViewerPane
          source={multiSelected ? null : focusedSource}
          multiSelected={multiSelected}
          runId={previewRunId}
          mode={previewMode}
          runStatus={previewRun?.status}
          runStage={previewRun?.progress?.stage}
          runFailedStage={previewRun?.error?.stage}
          width={pdfWidth}
          onResize={setPdfWidth}
          showActions={showPreviewActions}
          hasRun={!!previewRun}
          onRunNow={() => focusedSource && quickStart(focusedSource, convParams)}
          onOpenSettings={() => setModal({ type: "convSettings" })}
          onOpenDetails={() =>
            previewRun && focusedSource && openRunDetails(focusedSource.id, previewRun.id)
          }
          bloomRunning={bloom.running}
          bloomCollectionName={bloom.collectionName}
          onToast={showToast}
        />
      </div>

      <QueueBar
        runningCount={runningCount}
        queuedCount={queuedCount}
        sources={sources}
        folder={folder}
        bookCount={sources.length}
      />

      {modal?.type === "config" && (
        <RunConfig
          source={modal.source}
          run={modal.run}
          mode={t.configMode}
          parallelism={maxParallel}
          defaults={defaults}
          onClose={() => setModal(null)}
          onConfirm={onConfirmRun}
        />
      )}
      {modal?.type === "compare" && (
        <CompareModal
          source={modal.source}
          initialA={modal.initialA}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "settings" && (
        <SettingsModal
          settings={modal.draft}
          collections={collections}
          onChange={(s: Settings) => setModal({ type: "settings", draft: s })}
          onClose={() => saveSettingsModal(modal.draft)}
        />
      )}
      {modal?.type === "confirm" && <ConfirmModal {...modal} onClose={() => setModal(null)} />}
      {modal?.type === "convSettings" && (
        <ConvSettingsModal
          source={focusedSource}
          params={convParams}
          defaults={defaults}
          onChange={(k, v) => setConvParams((o) => ({ ...o, [k]: v }))}
          onRun={() => focusedSource && quickStart(focusedSource, convParams)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "runDetails" &&
        (() => {
          const s = sources.find((x) => x.id === modal.sourceId);
          const r = s?.runs.find((x) => x.id === modal.runId);
          if (!s || !r) return null;
          return (
            <RunDetailsModal
              run={r}
              source={s}
              onClose={() => setModal(null)}
              onMark={onMark}
              onPin={onPin}
              onNotes={onNotes}
              onCancel={onCancelRun}
              onConfigRerun={(src, run) => onConfigRun(src, run)}
              onResume={onResumeRun}
              onDelete={onDeleteRun}
              onCompare={(src) => setModal({ type: "compare", source: src, initialA: r.id })}
            />
          );
        })()}

      {toast && (
        <div
          className="scale-in"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 46,
            transform: "translateX(-50%)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "70vw",
            padding: "9px 14px",
            borderRadius: 10,
            boxShadow: "var(--shadow-lg)",
            fontSize: 12.5,
            fontWeight: 600,
            background:
              toast.kind === "error"
                ? "var(--st-fail-bg)"
                : toast.kind === "ok"
                  ? "var(--st-done-bg)"
                  : "var(--text)",
            color:
              toast.kind === "error"
                ? "var(--st-fail-fg)"
                : toast.kind === "ok"
                  ? "var(--st-done-fg)"
                  : "var(--bg)",
          }}
        >
          <Icon
            name={toast.kind === "error" ? "alert" : toast.kind === "ok" ? "check" : "eye"}
            size={15}
          />
          <span>{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            title="Dismiss"
            style={{
              display: "inline-flex",
              marginLeft: 4,
              border: "none",
              background: "transparent",
              color: "inherit",
              opacity: 0.7,
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({
  dark,
  onToggleTheme,
  onSettings,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  onSettings: () => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 46,
        padding: "0 12px 0 14px",
        background: "var(--chrome)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <img src="/app.svg" alt="" width={26} height={26} style={{ borderRadius: 7 }} />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.2px" }}>BloomBridge</div>
        </div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {/* The Bloom connection indicator now lives in the preview pane, just above the
            "Convert to Bloom" action where it's most relevant. */}
        <IconBtn name={dark ? "sun" : "moon"} onClick={onToggleTheme} title="Toggle theme" />
        <IconBtn name="settings" onClick={onSettings} title="Settings" />
      </div>
    </header>
  );
}

// ---------- Queue bar (bottom) ----------
function QueueBar({
  runningCount,
  queuedCount,
  folder,
  bookCount,
}: {
  runningCount: number;
  queuedCount: number;
  sources: Source[];
  folder: string | null;
  bookCount: number;
}) {
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 32,
        padding: "0 12px 0 14px",
        background: "var(--chrome)",
        borderTop: "1px solid var(--border)",
        flexShrink: 0,
        fontSize: 11,
        color: "var(--text-3)",
      }}
    >
      {folder ? (
        <span
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "50%",
          }}
        >
          <Icon name="folder" size={12} />
          {folder}
          <span style={{ opacity: 0.5 }}>·</span>
          {bookCount} books
        </span>
      ) : (
        <span>No folder selected</span>
      )}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Icon name="play" size={11} style={{ color: "var(--st-run-fg)" }} />
          {runningCount} running
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Icon name="clock" size={12} style={{ color: "var(--st-queued-fg)" }} />
          {queuedCount} queued
        </span>
      </div>
    </footer>
  );
}

// ---------- Collapsed left rail ----------
function LeftRail({
  folder,
  bookCount,
  onExpand,
}: {
  folder: string;
  bookCount: number;
  onExpand: () => void;
}) {
  return (
    <aside
      style={{
        width: 46,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 10,
        gap: 10,
      }}
    >
      <button
        onClick={onExpand}
        title={"Source folder: " + folder + " — click to change"}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          width: 34,
          padding: "7px 0",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
          cursor: "pointer",
          color: "var(--accent)",
        }}
      >
        <Icon name="folder" size={17} />
        <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "var(--text-2)" }}>
          {bookCount}
        </span>
      </button>
      <button
        onClick={onExpand}
        title="Expand"
        style={{
          marginTop: "auto",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text-2)",
          cursor: "pointer",
        }}
      >
        <Icon name="chevron" size={14} />
      </button>
    </aside>
  );
}

// ---------- Empty workspace (center, no folder) ----------
function EmptyWorkspace({
  recentFolders,
  onPick,
}: {
  recentFolders: string[];
  onPick: (p: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 40,
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 22,
          color: "var(--text-3)",
        }}
      >
        <Icon name="file" size={36} strokeWidth={1.1} />
        <Icon name="chevron" size={22} strokeWidth={1.4} />
        <img src="/app.svg" alt="" width={44} height={44} style={{ borderRadius: 11 }} />
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>
        Convert PDFs and EPUBs into Bloom books
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--text-2)",
          maxWidth: 400,
          lineHeight: 1.55,
          margin: "0 0 20px",
        }}
      >
        Paste a folder path in the left panel to scan it for PDFs. Each book can be converted with
        different settings — all runs are preserved so you can compare and pick the best.
      </p>
      {recentFolders.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Recent:</span>
          {recentFolders.slice(0, 4).map((f) => (
            <button
              key={f}
              onClick={() => onPick(f)}
              className="mono"
              title={f}
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "4px 11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <Icon name="folder" size={12} />
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
