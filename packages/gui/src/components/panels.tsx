/* Left source panel + right detail panel (ported from panels.jsx) */
import React from "react";
import { Icon } from "../lib/icons";
import { BLOOM } from "../data/mockData";
import {
  Btn,
  IconBtn,
  Field,
  Select,
  Toggle,
  InfoDot,
  Thumb,
  StatusPill,
  StageBadges,
  MarkControl,
  ProgressBar,
  runProgress,
  fmt,
  STATUS_META,
  effStatus,
} from "./primitives";
import type { ArtifactNode, Mark, Params, Run, Source, Stage } from "../types";
import { api, subscribeRunLog } from "../api";

// ============ LEFT: SOURCE PANEL ============
export function SourcePanel({
  folder,
  bookCount,
  recentFolders,
  onPick,
  onRescan,
  onCollapse,
}: {
  folder: string | null;
  bookCount: number;
  recentFolders: string[];
  onPick: (path: string) => void;
  onRescan?: () => void;
  onCollapse?: (() => void) | null;
}) {
  const [input, setInput] = React.useState(folder || "");
  React.useEffect(() => {
    setInput(folder || "");
  }, [folder]);
  const submit = () => {
    if (input.trim()) onPick(input.trim());
  };
  return (
    <aside
      style={{
        width: 262,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 12px 9px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".7px",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Source folder
        </span>
        {onCollapse && (
          <IconBtn
            name="panel-right"
            iconSize={15}
            size={22}
            title="Collapse panel"
            onClick={onCollapse}
          />
        )}
      </div>

      {/* path entry */}
      <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            aria-label="Folder path"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Paste a folder path…"
            className="mono"
            style={{
              flex: 1,
              minWidth: 0,
              height: 30,
              padding: "0 8px",
              fontSize: 11,
              color: "var(--text)",
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              outline: "none",
            }}
          />
          <Btn variant="primary" size="sm" icon="folder-open" onClick={submit}>
            Open
          </Btn>
        </div>
        {folder && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              fontSize: 10.5,
              color: "var(--text-2)",
            }}
          >
            <Icon name="folder-open" size={13} style={{ color: "var(--accent)" }} />
            <span>{bookCount} PDFs found</span>
            {onRescan && (
              <button
                onClick={onRescan}
                title="Rescan folder"
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-3)",
                  cursor: "pointer",
                  fontSize: 10.5,
                }}
              >
                <Icon name="refresh" size={12} />
                Rescan
              </button>
            )}
          </div>
        )}
      </div>

      {/* recent folders */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".6px",
            textTransform: "uppercase",
            color: "var(--text-3)",
            padding: "0 5px 7px",
          }}
        >
          Recent folders
        </div>
        {recentFolders.length === 0 && (
          <div style={{ fontSize: 10.5, color: "var(--text-3)", padding: "2px 6px" }}>
            None yet.
          </div>
        )}
        {recentFolders.map((f) => {
          const cur = f === folder;
          return (
            <button
              key={f}
              onClick={() => onPick(f)}
              title={f}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                padding: "8px 8px",
                marginBottom: 1,
                textAlign: "left",
                background: cur ? "var(--accent-soft)" : "transparent",
                border: "1px solid transparent",
                borderRadius: "var(--radius)",
                cursor: "pointer",
              }}
            >
              <Icon
                name="folder"
                size={15}
                style={{ color: cur ? "var(--accent)" : "var(--text-3)", flexShrink: 0 }}
              />
              <div
                className="mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  direction: "rtl",
                  textAlign: "left",
                }}
              >
                {f}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

const panelShell: React.CSSProperties = {
  width: 348,
  flexShrink: 0,
  background: "var(--surface)",
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

// ============ RIGHT: DETAIL PANEL ============
export function DetailPanel({
  run,
  source,
  onClose,
  onMark,
  onPreview,
  onConfigRerun,
  onResume,
  onCompare,
  onDelete,
  onNotes,
  onCancel,
}: {
  run?: Run | null;
  source?: Source;
  onClose: () => void;
  onMark: (sid: string, rid: string, v: Mark) => void;
  onPreview: (r: Run) => void;
  onConfigRerun: (s: Source, r: Run) => void;
  onResume: (s: Source, r: Run) => void;
  onCompare: (s: Source) => void;
  onDelete: (sid: string, rid: string) => void;
  onNotes: (sid: string, rid: string, patch: Partial<Run>) => void;
  onCancel: (sid: string, rid: string) => void;
}) {
  // Keep the active tab when switching between runs (don't reset to "artifacts").
  const [tab, setTab] = React.useState("artifacts");

  if (!run || !source) {
    return (
      <aside style={panelShell}>
        <PanelEmpty />
      </aside>
    );
  }
  return (
    <aside style={panelShell}>
      {/* header */}
      <div style={{ padding: "11px 14px 10px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 9,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".7px",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            Run detail
          </span>
          <IconBtn
            name="panel-right"
            iconSize={15}
            size={22}
            title="Collapse panel"
            onClick={onClose}
          />
        </div>
        <div style={{ display: "flex", gap: 11 }}>
          <Thumb hue={source.hue} w={42} h={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", lineHeight: 1.25 }}>
              {source.name}
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: "var(--text-3)", margin: "2px 0 7px" }}
            >
              {run.id}
              {source.pages ? ` · ${source.pages}p` : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* The disapproval is already conveyed by MarkControl below, so skip the
                  redundant "Disapproved" pill. */}
              {effStatus(run) !== "disapproved" && <StatusPill status={effStatus(run)} />}
              {run.status === "done" && (
                <MarkControl mark={run.mark} onChange={(v) => onMark(source.id, run.id, v)} />
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 11 }}>
          {run.status === "running" || run.status === "queued" ? (
            <Btn
              key="cancel"
              variant="danger"
              size="sm"
              icon="stop"
              onClick={() => onCancel(source.id, run.id)}
              style={{ flex: 1 }}
            >
              Cancel run
            </Btn>
          ) : run.status === "done" ? (
            <Btn
              key="preview"
              variant="primary"
              size="sm"
              icon="eye"
              onClick={() => onPreview(run)}
              style={{ flex: 1 }}
            >
              Preview in Bloom
            </Btn>
          ) : run.status === "failed" ? (
            <Btn
              key="rerun"
              variant="primary"
              size="sm"
              icon="refresh"
              onClick={() => onConfigRerun(source, run)}
              style={{ flex: 1 }}
            >
              Re-run
            </Btn>
          ) : (
            <Btn
              key="run"
              variant="primary"
              size="sm"
              icon="play"
              onClick={() => onConfigRerun(source, run)}
              style={{ flex: 1 }}
            >
              Run
            </Btn>
          )}
          {run.status === "done" && (
            <IconBtn
              name="refresh"
              title="Re-run with new settings"
              onClick={() => onConfigRerun(source, run)}
            />
          )}
          <CopyRunButton source={source} run={run} />
          <IconBtn
            name="trash"
            title="Delete run"
            danger
            onClick={() => onDelete(source.id, run.id)}
          />
        </div>

        {run.status === "failed" && (
          <Btn
            variant="ghost"
            size="sm"
            icon="layers"
            onClick={() => onResume(source, run)}
            style={{ width: "100%", marginTop: 6 }}
            title={
              run.resumeStage
                ? `Reuse cached output through ${BLOOM.STAGE_LABELS[run.resumeStage] || run.resumeStage} and continue`
                : "Start over from the PDF (no earlier stage completed)"
            }
          >
            Run from last successful stage
          </Btn>
        )}
      </div>

      {/* error banner */}
      {run.status === "failed" && run.error && <ErrorBanner error={run.error} />}

      {/* tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "8px 10px 0",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {(
          [
            ["log", "Log"],
            ["artifacts", "Artifacts"],
            ["details", "Settings"],
            ["metrics", "Metrics"],
            ["notes", "Notes"],
          ] as [string, string][]
        ).map(([v, l]) => {
          // Highlight the Notes tab (and show a text icon) whenever it holds content.
          const hasNotes = v === "notes" && !!run.notes && run.notes.trim().length > 0;
          return (
            <button
              key={v}
              onClick={() => setTab(v)}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "7px 11px 9px",
                border: "none",
                background: "transparent",
                fontSize: 12,
                fontWeight: 600,
                color: tab === v ? "var(--text)" : hasNotes ? "var(--accent)" : "var(--text-3)",
                cursor: "pointer",
              }}
            >
              {hasNotes && <Icon name="note" size={12} />}
              {l}
              {tab === v && (
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    right: 8,
                    bottom: -1,
                    height: 2,
                    borderRadius: 2,
                    background: "var(--accent)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {tab === "log" && <LogTab run={run} />}
        {tab === "details" && <DetailsTab run={run} source={source} />}
        {tab === "metrics" && <MetricsTab run={run} />}
        {tab === "artifacts" && <ArtifactsTab run={run} />}
        {tab === "notes" && <NotesTab run={run} source={source} onNotes={onNotes} />}
      </div>
    </aside>
  );
}

// ---------- Log tab (live conversion log) ----------
function LogTab({ run }: { run: Run }) {
  const [lines, setLines] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true); // auto-scroll only while pinned to the bottom

  // Load the current log, then follow live lines while the run is active.
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .runLog(run.id)
      .then((r) => {
        if (alive) setLines(r.lines);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    const unsub =
      run.status === "running" || run.status === "queued"
        ? subscribeRunLog(run.id, (line) => setLines((prev) => [...prev, line]))
        : () => {};
    return () => {
      alive = false;
      unsub();
    };
  }, [run.id, run.status]);

  // Keep pinned to the bottom as new lines arrive (unless the user scrolled up).
  React.useEffect(() => {
    const el = boxRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px 6px",
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        <Icon name="info" size={12} />
        {run.status === "running"
          ? "Live — following the conversion as it runs."
          : "Conversion log."}
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="mono"
        style={{
          flex: 1,
          overflowY: "auto",
          margin: "0 12px 12px",
          padding: "9px 11px",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          fontSize: 11,
          lineHeight: 1.55,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {loading ? "Loading…" : lines.length ? lines.join("\n") : "No log output yet."}
      </div>
    </div>
  );
}

function PanelEmpty() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        textAlign: "center",
        color: "var(--text-3)",
      }}
    >
      <Icon name="layers" size={30} strokeWidth={1.2} />
      <p style={{ fontSize: 12.5, margin: "12px 0 0", lineHeight: 1.5 }}>
        Select a run to see its
        <br />
        parameters, metrics, and artifacts.
      </p>
    </div>
  );
}

function ErrorBanner({ error }: { error: NonNullable<Run["error"]> }) {
  return (
    <div
      style={{
        margin: "11px 14px 0",
        padding: "10px 12px",
        borderRadius: "var(--radius)",
        background: "var(--st-fail-bg)",
        border: "1px solid color-mix(in oklch, var(--st-fail-fg) 30%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: "var(--st-fail-fg)",
          marginBottom: 5,
        }}
      >
        <Icon name="alert" size={15} />
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {error.stage && BLOOM.STAGE_LABELS[error.stage]
            ? `Failed during ${BLOOM.STAGE_LABELS[error.stage]}`
            : "Conversion failed"}
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
        {error.message}
      </p>
    </div>
  );
}

// ---------- Details (Settings) tab ----------
function DetailRow({ label, children }: { label: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 11.5, color: "var(--text-3)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", textAlign: "right" }}>
        {children}
      </span>
    </div>
  );
}

function DetailsTab({ run, source }: { run: Run; source: Source }) {
  const p = run.params || ({} as Params);
  return (
    <div style={{ padding: "12px 14px 18px" }}>
      {/* stage badges */}
      <div style={{ marginBottom: 14 }}>
        <SectionLabel>Pipeline</SectionLabel>
        <StageBadges
          stages={run.stages}
          currentStage={run.status === "running" ? run.progress && run.progress.stage : null}
          failedStage={run.status === "failed" && run.error ? run.error.stage : null}
        />
        {run.status === "running" && run.progress && (
          <div style={{ marginTop: 9 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-2)",
                marginBottom: 5,
                whiteSpace: "nowrap",
                gap: 8,
              }}
            >
              <span>{BLOOM.STAGE_LABELS[run.progress.stage]} running</span>
              {run.progress.pages ? (
                <span className="mono">
                  page {run.progress.page}/{run.progress.pages}
                </span>
              ) : (
                <span className="mono">{Math.round(runProgress(run) * 100)}%</span>
              )}
            </div>
            <ProgressBar value={runProgress(run)} />
          </div>
        )}
      </div>

      <SectionLabel>Parameters</SectionLabel>
      <div style={{ marginBottom: 8 }}>
        <DetailRow label="OCR method">{BLOOM.ocrMethods[p.ocrMethod]}</DetailRow>
        <DetailRow label="LLM model">
          {BLOOM.MODELS[p.model] ? BLOOM.MODELS[p.model].label : run.model}
        </DetailRow>
        <DetailRow label="Vision formatting">{p.visionFormatting ? "On" : "Off"}</DetailRow>
        {p.visionFormatting && (
          <DetailRow
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Vision-formatting model <InfoDot tip="detects per-page text alignment" />
              </span>
            }
          >
            {BLOOM.MODELS[p.visionModel] ? BLOOM.MODELS[p.visionModel].label : "—"}
          </DetailRow>
        )}
        <DetailRow label="Cover handling">{BLOOM.coverModes[p.coverMode]}</DetailRow>
        <DetailRow label="Flatten complex pages">
          {BLOOM.complexLevels[p.complexBecomesImage]}
        </DetailRow>
        <DetailRow label="Target output">{BLOOM.targets[p.target]}</DetailRow>
        <DetailRow label="Started">{run.ts}</DetailRow>
      </div>

      {/* command summary */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Command</SectionLabel>
        <CopyButton getText={() => cmdString(source, run)} title="Copy command" label="Copy" />
      </div>
      <pre
        className="mono"
        style={{
          margin: "0 0 14px",
          padding: "9px 11px",
          fontSize: 10.5,
          lineHeight: 1.6,
          color: "var(--text-2)",
          background: "var(--surface-3)",
          borderRadius: "var(--radius-sm)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {cmdString(source, run)}
      </pre>
    </div>
  );
}

// ---------- Notes tab ----------
function NotesTab({
  run,
  source,
  onNotes,
}: {
  run: Run;
  source: Source;
  onNotes: (sid: string, rid: string, patch: Partial<Run>) => void;
}) {
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", flex: 1 }}>
      <SectionLabel>Notes</SectionLabel>
      <textarea
        value={run.notes}
        onChange={(e) => onNotes(source.id, run.id, { notes: e.target.value })}
        placeholder="Add a note about this run…"
        autoFocus
        style={{
          width: "100%",
          flex: 1,
          minHeight: 140,
          resize: "vertical",
          padding: "9px 11px",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--text)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          outline: "none",
        }}
      />
    </div>
  );
}

// ---------- Metrics tab ----------
function MetricsTab({ run }: { run: Run }) {
  const rows = run.breakdown && run.breakdown.length ? run.breakdown : [];
  const tot = rows.reduce(
    (a, r) => ({
      dur: a.dur + r.dur,
      tin: a.tin + r.tin,
      tout: a.tout + r.tout,
      cost: a.cost + r.cost,
    }),
    { dur: 0, tin: 0, tout: 0, cost: 0 },
  );
  return (
    <div style={{ padding: "12px 14px 18px" }}>
      {/* big numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <BigStat icon="coin" label="Total cost" value={fmt.cost(run.cost)} accent />
        <BigStat icon="clock" label="Total time" value={fmt.time(run.time)} />
        <BigStat icon="cpu" label="Tokens in" value={fmt.tokens(run.tokensIn)} />
        <BigStat icon="cpu" label="Tokens out" value={fmt.tokens(run.tokensOut)} />
      </div>

      <SectionLabel>By stage</SectionLabel>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <div
          className="mono"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
            gap: 8,
            padding: "6px 10px",
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: ".4px",
            textTransform: "uppercase",
            color: "var(--text-3)",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span>Stage</span>
          <span style={{ textAlign: "right" }}>Time</span>
          <span style={{ textAlign: "right" }}>Tok i/o</span>
          <span style={{ textAlign: "right" }}>Cost</span>
        </div>
        {rows.map((r) => {
          const active = r.dur > 0 || r.cost > 0;
          return (
            <div
              key={r.stage}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 8,
                padding: "8px 10px",
                fontSize: 11.5,
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
                opacity: active ? 1 : 0.45,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: active ? "var(--st-done-fg)" : "var(--border-strong)",
                  }}
                />
                {r.label || BLOOM.STAGE_LABELS[r.stage as Stage] || r.stage}
              </span>
              <span className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>
                {r.dur ? r.dur + "s" : "—"}
              </span>
              <span className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>
                {r.tin ? fmt.tokens(r.tin) + "/" + fmt.tokens(r.tout) : "—"}
              </span>
              <span className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                {r.cost ? fmt.cost(r.cost) : "—"}
              </span>
            </div>
          );
        })}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
            gap: 8,
            padding: "8px 10px",
            fontSize: 11.5,
            alignItems: "center",
            background: "var(--surface-2)",
            fontWeight: 700,
          }}
        >
          <span>Total</span>
          <span className="mono" style={{ textAlign: "right" }}>
            {fmt.timeClock(tot.dur)}
          </span>
          <span className="mono" style={{ textAlign: "right" }}>
            {fmt.tokens(tot.tin)}/{fmt.tokens(tot.tout)}
          </span>
          <span className="mono" style={{ textAlign: "right", color: "var(--accent)" }}>
            {fmt.cost(tot.cost)}
          </span>
        </div>
      </div>
      {/* cost bar */}
      {tot.cost > 0 && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Cost distribution</SectionLabel>
          <div
            style={{
              display: "flex",
              height: 10,
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--surface-3)",
            }}
          >
            {rows
              .filter((r) => r.cost > 0)
              .map((r, i) => (
                <div
                  key={r.stage}
                  title={
                    (r.label || BLOOM.STAGE_LABELS[r.stage as Stage] || r.stage) +
                    " · " +
                    fmt.cost(r.cost)
                  }
                  style={{
                    width: (r.cost / tot.cost) * 100 + "%",
                    background: `oklch(${0.6 - i * 0.05} 0.13 ${256 + i * 30})`,
                  }}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BigStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 11px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          color: "var(--text-3)",
          marginBottom: 5,
        }}
      >
        <Icon name={icon} size={13} />
        <span style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</span>
      </div>
      <div
        className="metric"
        style={{
          fontSize: 19,
          fontWeight: 700,
          color: accent ? "var(--accent)" : "var(--text)",
          letterSpacing: "-.5px",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------- Artifacts tab (fetched from the server, read-only) ----------
interface ArtFile {
  name: string;
  path: string;
  kind: string;
  stage: string;
}

// Artifact groups in pipeline order.
const ARTIFACT_STAGES: [string, string][] = [
  ["ocr", "OCR"],
  ["llm", "Think (LLM)"],
  ["plan", "Plan"],
  ["html", "HTML"],
];
function ArtifactsTab({ run }: { run: Run }) {
  const [files, setFiles] = React.useState<ArtFile[]>([]);
  const [sel, setSel] = React.useState<ArtFile | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [bookFolder, setBookFolder] = React.useState<string | undefined>(undefined);

  const selectFile = React.useCallback(
    (f: ArtFile) => {
      setSel(f);
      setContent(null);
      if (f.kind === "image") return;
      api
        .artifactFile(run.id, f.name)
        .then((r) => setContent(r.content))
        .catch(() => setContent(null));
    },
    [run.id],
  );

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setSel(null);
    setContent(null);
    api
      .artifacts(run.id)
      .then((r) => {
        if (!alive) return;
        setFiles(r.tree || []);
        setBookFolder(r.bookFolder);
        setLoading(false);
        if (r.tree && r.tree[0]) selectFile(r.tree[0]);
      })
      .catch(() => {
        if (alive) {
          setFiles([]);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
    // Re-fetch when the run finishes (status change) so new artifacts appear.
  }, [run.id, run.status, selectFile]);

  if (loading) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
        Loading artifacts…
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
        No artifacts yet — this run hasn't produced output.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {bookFolder && (
        <div style={{ display: "flex", gap: 6, padding: "10px 12px 0" }}>
          <Btn
            variant="default"
            size="sm"
            icon="folder-open"
            onClick={() => api.osOpen(bookFolder, "folder")}
          >
            File Explorer
          </Btn>
          <Btn
            variant="default"
            size="sm"
            icon="code"
            onClick={() => api.osOpen(bookFolder, "vscode")}
          >
            VS Code
          </Btn>
        </div>
      )}
      <div
        style={{
          padding: "8px 12px 8px",
          borderBottom: "1px solid var(--border)",
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {ARTIFACT_STAGES.map(([key, label]) => {
          const group = files.filter((f) => f.stage === key);
          if (!group.length) return null;
          return (
            <div key={key} style={{ marginBottom: 6 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".5px",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  padding: "5px 6px 2px",
                }}
              >
                {label}
              </div>
              {group.map((f) => (
                <ArtRow
                  key={f.path}
                  file={f}
                  active={sel?.name === f.name}
                  onSelect={() => selectFile(f)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {sel ? (
          <ArtFileView file={sel} content={content} />
        ) : (
          <div
            style={{ color: "var(--text-3)", fontSize: 12, textAlign: "center", paddingTop: 20 }}
          >
            Select a file
          </div>
        )}
      </div>
    </div>
  );
}

// One artifact row with hover actions: copy path + open with default app.
function ArtRow({
  file,
  active,
  onSelect,
}: {
  file: ArtFile;
  active: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 4,
        paddingRight: 4,
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    >
      <button
        onClick={onSelect}
        style={{
          ...treeRow(0),
          flex: 1,
          minWidth: 0,
          background: "transparent",
          color: active ? "var(--accent)" : "var(--text-2)",
        }}
      >
        <Icon
          name={file.kind === "image" ? "image" : file.kind === "code" ? "code" : "file"}
          size={12}
        />
        <span
          style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {file.name}
        </span>
      </button>
      <span
        style={{ display: "flex", gap: 1, flexShrink: 0, visibility: hover ? "visible" : "hidden" }}
      >
        <IconBtn
          name={copied ? "check" : "copy"}
          size={22}
          iconSize={12}
          title="Copy path"
          color={copied ? "var(--good)" : undefined}
          onClick={() =>
            copyToClipboard(file.path, () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
          }
        />
        <IconBtn
          name="external"
          size={22}
          iconSize={12}
          title="Open with default app"
          onClick={() => api.osOpen(file.path, "file")}
        />
      </span>
    </div>
  );
}

function ArtFileView({ file, content }: { file: ArtFile; content: string | null }) {
  return (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 9,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Icon
          name={file.kind === "image" ? "image" : file.kind === "code" ? "code" : "file"}
          size={14}
          style={{ color: "var(--accent)" }}
        />
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
          {file.name}
        </span>
      </div>
      {file.kind === "image" ? (
        <div
          style={{
            borderRadius: "var(--radius)",
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <img
            src={`/api/artifact-raw?p=${encodeURIComponent(file.path)}`}
            alt={file.name}
            style={{ width: "100%", display: "block" }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div
            style={{ padding: "6px 9px", fontSize: 10.5, color: "var(--text-3)" }}
            className="mono"
          >
            {file.name}
          </div>
        </div>
      ) : (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.65,
            color: "var(--text-2)",
            background: "var(--surface-3)",
            borderRadius: "var(--radius)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {content ?? "…"}
        </pre>
      )}
      <div
        style={{
          marginTop: 8,
          fontSize: 10.5,
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Icon name="info" size={12} /> Read-only — intermediate pipeline output.
      </div>
    </div>
  );
}

function firstFile(nodes: ArtifactNode[]): ArtifactNode | null {
  for (const n of nodes) {
    if (n.type === "file") return n;
    if (n.children) {
      const f = firstFile(n.children);
      if (f) return f;
    }
  }
  return null;
}

function FileTree({
  nodes,
  sel,
  onSel,
  depth,
}: {
  nodes: ArtifactNode[];
  sel: ArtifactNode | null;
  onSel: (n: ArtifactNode) => void;
  depth: number;
}) {
  return (
    <>
      {nodes.map((n, i) => (
        <TreeNode key={i} node={n} sel={sel} onSel={onSel} depth={depth} />
      ))}
    </>
  );
}
function TreeNode({
  node,
  sel,
  onSel,
  depth,
}: {
  node: ArtifactNode;
  sel: ArtifactNode | null;
  onSel: (n: ArtifactNode) => void;
  depth: number;
}) {
  const [open, setOpen] = React.useState(node.open !== false);
  if (node.type === "dir") {
    return (
      <div>
        <button onClick={() => setOpen((v) => !v)} style={treeRow(depth)}>
          <span
            style={{
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform .12s",
              color: "var(--text-3)",
              display: "inline-flex",
            }}
          >
            <Icon name="chevron" size={11} />
          </span>
          <Icon
            name={open ? "folder-open" : "folder"}
            size={13}
            style={{ color: "var(--text-3)" }}
          />
          <span style={{ fontWeight: 600 }}>{node.name}</span>
        </button>
        {open &&
          node.children &&
          node.children.map((c, i) => (
            <TreeNode key={i} node={c} sel={sel} onSel={onSel} depth={depth + 1} />
          ))}
      </div>
    );
  }
  const active = sel === node;
  return (
    <button
      onClick={() => onSel(node)}
      style={{
        ...treeRow(depth),
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-2)",
      }}
    >
      <Icon
        name={node.kind === "image" ? "image" : node.kind === "code" ? "code" : "file"}
        size={12}
        style={{ marginLeft: 11 }}
      />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
      <span className="mono" style={{ fontSize: 9.5, opacity: 0.6 }}>
        {node.size}
      </span>
    </button>
  );
}
function treeRow(depth: number): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "3px 6px",
    paddingLeft: 6 + depth * 13,
    textAlign: "left",
    border: "none",
    background: "transparent",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 11.5,
    color: "var(--text-2)",
  };
}

function FileView({ file }: { file: ArtifactNode }) {
  return (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 9,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Icon
          name={file.kind === "image" ? "image" : file.kind === "code" ? "code" : "file"}
          size={14}
          style={{ color: "var(--accent)" }}
        />
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
          {file.name}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <IconBtn name="copy" size={24} iconSize={13} title="Copy" />
          <IconBtn name="download" size={24} iconSize={13} title="Download" />
        </span>
      </div>
      {file.kind === "image" ? (
        <div
          style={{
            borderRadius: "var(--radius)",
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              aspectRatio: "4/3",
              background: `repeating-linear-gradient(45deg, oklch(0.72 0.09 ${file.hue}), oklch(0.72 0.09 ${file.hue}) 10px, oklch(0.66 0.1 ${file.hue}) 10px, oklch(0.66 0.1 ${file.hue}) 20px)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                color: "oklch(0.25 0.05 " + file.hue + ")",
                background: "oklch(1 0 0 / .75)",
                padding: "3px 8px",
                borderRadius: 4,
              }}
            >
              extracted image
            </span>
          </div>
        </div>
      ) : (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.65,
            color: "var(--text-2)",
            background: "var(--surface-3)",
            borderRadius: "var(--radius)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {file.body}
        </pre>
      )}
      <div
        style={{
          marginTop: 8,
          fontSize: 10.5,
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Icon name="info" size={12} /> Read-only — artifacts reflect intermediate pipeline output.
      </div>
    </div>
  );
}

export function SectionLabel({ children }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".6px",
        textTransform: "uppercase",
        color: "var(--text-3)",
        margin: "0 0 8px",
      }}
    >
      {children}
    </div>
  );
}

export function cmdString(source: Source, run: Run) {
  const p = run.params || ({} as Params);
  return (
    "pdf2bloom " +
    source.file +
    " \\\n  --ocr " +
    p.ocrMethod +
    " \\\n  --model " +
    p.model +
    (p.visionFormatting
      ? " \\\n  --vision-model " + p.visionModel
      : " \\\n  --no-vision-formatting") +
    " \\\n  --cover " +
    p.coverMode +
    (p.complexBecomesImage !== "off"
      ? " \\\n  --complex-becomes-image " + p.complexBecomesImage
      : "") +
    " \\\n  --target " +
    p.target
  );
}

// Build a complete, agent-friendly text report of a run's inputs + outputs
function buildRunReport(source: Source, run: Run) {
  const p = run.params || ({} as Params);
  const L: string[] = [];
  L.push("# Bloom conversion run report");
  L.push("");
  L.push("## Source PDF");
  L.push(`- Title: ${source.name}`);
  L.push(`- File: ${source.file}`);
  L.push(`- Pages: ${source.pages}`);
  L.push(`- Size: ${source.size}`);
  L.push("");
  L.push("## Run");
  L.push(`- Run ID: ${run.id}`);
  L.push(`- Status: ${(STATUS_META[run.status] || {}).label || run.status}`);
  L.push(`- Quality mark: ${run.mark}`);
  L.push(`- Started: ${run.ts}`);
  if (run.notes) L.push(`- Notes: ${run.notes}`);
  L.push("");
  L.push("## Inputs — conversion settings");
  L.push(`- OCR method: ${BLOOM.ocrMethods[p.ocrMethod]}`);
  L.push(`- LLM model: ${(BLOOM.MODELS[p.model] || {}).label || p.model}`);
  L.push(`- Vision formatting: ${p.visionFormatting ? "on" : "off"}`);
  if (p.visionFormatting)
    L.push(
      `- Vision-formatting model: ${(BLOOM.MODELS[p.visionModel] || {}).label || p.visionModel} (detects per-page text alignment)`,
    );
  L.push(`- Cover handling: ${BLOOM.coverModes[p.coverMode]}`);
  L.push(`- Flatten complex pages as image: ${BLOOM.complexLevels[p.complexBecomesImage]}`);
  L.push(`- Target output: ${BLOOM.targets[p.target]}`);
  L.push("");
  L.push("Command:");
  L.push("```");
  L.push(cmdString(source, run));
  L.push("```");
  L.push("");
  L.push("## Pipeline");
  const doneStages = BLOOM.STAGES.filter((s) => run.stages[s]).map((s) => BLOOM.STAGE_LABELS[s]);
  L.push(`- Stages completed: ${doneStages.length ? doneStages.join(" -> ") : "none"}`);
  if (run.status === "running" && run.progress)
    L.push(
      `- Currently running: ${BLOOM.STAGE_LABELS[run.progress.stage]} (page ${run.progress.page}/${run.progress.pages})`,
    );
  if (run.status === "failed" && run.error) {
    const st = run.error.stage ? BLOOM.STAGE_LABELS[run.error.stage] : null;
    L.push(st ? `- FAILED during ${st}` : "- FAILED");
    L.push(`  - Message: ${run.error.message}`);
  }
  L.push("");
  L.push("## Outputs — metrics");
  L.push(`- Total cost: ${fmt.cost(run.cost)}`);
  L.push(`- Total time: ${fmt.time(run.time)}`);
  L.push(`- Tokens: ${run.tokensIn} in / ${run.tokensOut} out`);
  if (run.breakdown && run.breakdown.length) {
    L.push("");
    L.push("Per-stage breakdown:");
    L.push("| Stage | Time (s) | Tokens in | Tokens out | Cost |");
    L.push("|---|---|---|---|---|");
    run.breakdown.forEach((b) =>
      L.push(
        `| ${b.label || BLOOM.STAGE_LABELS[b.stage as Stage] || b.stage} | ${b.dur} | ${b.tin} | ${b.tout} | ${fmt.cost(b.cost)} |`,
      ),
    );
  }
  if (run.status === "done" || doneStages.length) {
    L.push("");
    L.push("## Artifacts (intermediate output files)");
    (function walk(nodes: ArtifactNode[], prefix: string) {
      nodes.forEach((n) => {
        if (n.type === "dir") walk(n.children || [], prefix + n.name + "/");
        else L.push(`- ${prefix + n.name} (${n.size})`);
      });
    })(BLOOM.artifactTree, "");
  }
  return L.join("\n");
}

function copyToClipboard(text: string, done?: () => void) {
  const finish = () => done && done();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(finish, () => {
        fallbackCopy(text);
        finish();
      });
      return;
    }
  } catch (e) {
    /* fall through */
  }
  fallbackCopy(text);
  finish();
}

function CopyRunButton({ source, run }: { source: Source; run: Run }) {
  const [done, setDone] = React.useState(false);
  return (
    <IconBtn
      name={done ? "check" : "copy"}
      title="Copy full run report (inputs + outputs) for an agent"
      color={done ? "var(--good)" : undefined}
      onClick={() =>
        copyToClipboard(buildRunReport(source, run), () => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        })
      }
    />
  );
}

// generic copy-text button with a small label
export function CopyButton({
  getText,
  title,
  label = "Copy",
}: {
  getText: () => string;
  title?: string;
  label?: string;
}) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      title={title}
      onClick={() =>
        copyToClipboard(getText(), () => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 8px",
        marginBottom: 8,
        border: "1px solid var(--border-strong)",
        background: "var(--surface)",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        color: done ? "var(--good)" : "var(--text-2)",
        cursor: "pointer",
      }}
    >
      <Icon name={done ? "check" : "copy"} size={11} />
      {done ? "Copied" : label}
    </button>
  );
}
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    /* ignore */
  }
  document.body.removeChild(ta);
}

// ============ Raw parameter controls (shared by config modal + PDF + batch panes) ============
// Orange highlight for any setting whose value differs from the default.
const CHANGED_OUTLINE = "3px solid #f97316";
function Changed({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        outline: on ? CHANGED_OUTLINE : undefined,
        outlineOffset: on ? 2 : 0,
        borderRadius: 7,
      }}
    >
      {children}
    </div>
  );
}

export function ParamControls({
  params: p,
  onChange: set,
  defaults,
}: {
  params: Params;
  onChange: (k: keyof Params, v: any) => void;
  defaults?: Params;
}) {
  const d = defaults || (BLOOM.DEFAULT_PARAMS as Params);
  const chg = (k: keyof Params) => p[k] !== d[k];
  return (
    <React.Fragment>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <Changed on={chg("ocrMethod")}>
          <Field label="OCR method">
            <Select
              full
              value={p.ocrMethod}
              onChange={(v) => set("ocrMethod", v)}
              options={Object.entries(BLOOM.ocrMethods).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </Changed>
        <Changed on={chg("model")}>
          <Field label="LLM model">
            <Select
              full
              value={p.model}
              onChange={(v) => set("model", v)}
              options={Object.entries(BLOOM.MODELS).map(([value, m]) => ({
                value,
                label: m.label,
              }))}
            />
          </Field>
        </Changed>
        <Changed on={chg("coverMode")}>
          <Field label="Cover handling">
            <Select
              full
              value={p.coverMode}
              onChange={(v) => set("coverMode", v)}
              options={Object.entries(BLOOM.coverModes).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </Changed>
        <Changed on={chg("target")}>
          <Field label="Target output">
            <Select
              full
              value={p.target}
              onChange={(v) => set("target", v)}
              options={BLOOM.targetOrder.map((v) => ({ value: v, label: BLOOM.targets[v] }))}
            />
          </Field>
        </Changed>
      </div>
      <Changed on={chg("visionFormatting")}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 0 10px",
            marginTop: 8,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Vision formatting</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              Preserve layout &amp; styling with model vision
            </div>
          </div>
          <Toggle value={p.visionFormatting} onChange={(v) => set("visionFormatting", v)} />
        </div>
      </Changed>
      <div
        style={{
          paddingBottom: 4,
          opacity: p.visionFormatting ? 1 : 0.45,
          pointerEvents: p.visionFormatting ? "auto" : "none",
        }}
      >
        <Changed on={chg("visionModel")}>
          <Field
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Vision-formatting model <InfoDot tip="detects per-page text alignment" />
              </span>
            }
          >
            <Select
              full
              value={p.visionModel}
              onChange={(v) => set("visionModel", v)}
              options={Object.entries(BLOOM.MODELS).map(([value, m]) => ({
                value,
                label: m.label,
              }))}
            />
          </Field>
        </Changed>
      </div>
      <div style={{ padding: "12px 0 4px", borderTop: "1px solid var(--border)" }}>
        <Changed on={chg("complexBecomesImage")}>
          <Field
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                When to just treat the page as an image{" "}
                <InfoDot tip="When a page is too complex to rebuild as editable HTML, import it as a single full-page image. Lower numbers flatten more readily; 0 flattens every canvas page; off never does. 'Always' imports every page as an image (only a few pages are OCR'd for metadata/languages; no per-page layout analysis)." />
              </span>
            }
          >
            <Select
              full
              value={p.complexBecomesImage}
              onChange={(v) => set("complexBecomesImage", v)}
              options={BLOOM.complexOrder.map((v) => ({ value: v, label: BLOOM.complexLevels[v] }))}
            />
          </Field>
        </Changed>
      </div>
    </React.Fragment>
  );
}

// Target Bloom collection picker (language hints + where Preview/Keeper copy to).
export function CollectionPicker({
  value,
  onChange,
  collections,
}: {
  value: string;
  onChange: (v: string) => void;
  collections: { path: string; name: string }[];
}) {
  const options = [
    { value: "__running__", label: "The collection in the running Bloom" },
    ...collections.map((c) => ({ value: c.path, label: c.name })),
    { value: "", label: "No collection" },
  ];
  return (
    <Field label="Bloom collection">
      <Select full value={value} onChange={onChange} options={options} />
    </Field>
  );
}

// ============ PDF (book) detail pane ============
export function PdfDetail({
  source,
  defaultParams,
  parallelism,
  collection,
  onCollection,
  collections,
  onClose,
  onRunNow,
  onPreview,
}: {
  source: Source;
  defaultParams?: Params;
  parallelism: number;
  collection: string;
  onCollection: (v: string) => void;
  collections: { path: string; name: string }[];
  onClose: () => void;
  onRunNow: (params: Params) => void;
  onPreview?: (r: Run) => void;
  onSelectRun?: (sid: string, rid: string) => void;
  onMark?: (sid: string, rid: string, v: Mark) => void;
}) {
  // Most recent run that produced a Bloom book (runs are newest-first).
  const previewable = source.runs.find((r) => r.status === "done");
  const [params, setParams] = React.useState<Params>(() => ({
    ...(source.runs[0]?.params || defaultParams || BLOOM.DEFAULT_PARAMS),
  }));
  const set = (k: keyof Params, v: any) => setParams((o) => ({ ...o, [k]: v }));
  return (
    <aside style={panelShell}>
      <div style={{ padding: "11px 14px 12px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 11,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".7px",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            PDF
          </span>
          <IconBtn
            name="panel-right"
            iconSize={15}
            size={22}
            title="Collapse panel"
            onClick={onClose}
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Thumb hue={source.hue} w={48} h={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              {source.name}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>
              {source.file}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
              {source.pages ? `${source.pages} pages · ` : ""}
              {source.size}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 18px" }}>
        {/* Primary action: once a run has produced a Bloom book, Preview is the
            highlighted default; otherwise Run conversion is. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
          {previewable ? (
            <>
              <Btn
                variant="primary"
                size="lg"
                icon="eye"
                full
                onClick={() => onPreview?.(previewable)}
                title="Open the most recent completed run in Bloom"
              >
                Preview in Bloom
              </Btn>
              <Btn variant="default" size="md" icon="play" full onClick={() => onRunNow(params)}>
                Run conversion
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="primary" size="lg" icon="play" full onClick={() => onRunNow(params)}>
                Run conversion
              </Btn>
              <Btn
                variant="default"
                size="md"
                icon="eye"
                full
                disabled
                title="No completed run to preview yet"
              >
                Preview in Bloom
              </Btn>
            </>
          )}
        </div>

        {/* target collection + raw settings */}
        <SectionLabel>Conversion settings</SectionLabel>
        <div style={{ marginBottom: 12 }}>
          <CollectionPicker value={collection} onChange={onCollection} collections={collections} />
        </div>
        <ParamControls params={params} onChange={set} defaults={defaultParams} />
      </div>
    </aside>
  );
}

// ============ Batch pane (multiple PDFs selected) ============
export function BatchPane({
  count,
  parallelism,
  defaultParams,
  collection,
  onCollection,
  collections,
  onClose,
  onClear,
  onRun,
}: {
  count: number;
  parallelism: number;
  defaultParams?: Params;
  collection: string;
  onCollection: (v: string) => void;
  collections: { path: string; name: string }[];
  onClose: () => void;
  onClear: () => void;
  onRun: (params: Params) => void;
}) {
  const [params, setParams] = React.useState<Params>(() => ({
    ...(defaultParams || BLOOM.DEFAULT_PARAMS),
  }));
  const set = (k: keyof Params, v: any) => setParams((o) => ({ ...o, [k]: v }));
  return (
    <aside style={panelShell}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".7px",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Batch run
        </span>
        <IconBtn
          name="panel-right"
          iconSize={15}
          size={22}
          title="Collapse panel"
          onClick={onClose}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px" }}>
        {/* count only — no per-PDF info */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: 18,
          }}
        >
          <span style={{ position: "relative", display: "inline-flex", marginBottom: 12 }}>
            <span
              style={{
                position: "absolute",
                inset: 0,
                transform: "translate(6px,6px)",
                borderRadius: 6,
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
              }}
            />
            <span
              style={{
                position: "absolute",
                inset: 0,
                transform: "translate(3px,3px)",
                borderRadius: 6,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            />
            <span
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 46,
                height: 46,
                borderRadius: 6,
                background: "var(--accent-soft)",
                border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
                color: "var(--accent)",
              }}
            >
              <Icon name="file" size={22} />
            </span>
          </span>
          <div
            className="metric"
            style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-.5px" }}
          >
            {count}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
            PDFs selected for batch
          </div>
        </div>

        <Btn variant="primary" size="lg" icon="play" full onClick={() => onRun(params)}>
          Run {count} {count === 1 ? "book" : "books"}
        </Btn>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            textAlign: "center",
            margin: "8px 0 18px",
            lineHeight: 1.5,
          }}
        >
          Starts one run per book with the settings below.
          <br />
          {parallelism} run in parallel — the rest queue automatically.
        </div>

        <SectionLabel>Conversion settings for all</SectionLabel>
        <div style={{ marginBottom: 12 }}>
          <CollectionPicker value={collection} onChange={onCollection} collections={collections} />
        </div>
        <ParamControls params={params} onChange={set} defaults={defaultParams} />

        <button
          onClick={onClear}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            marginTop: 16,
            padding: "8px",
            background: "transparent",
            border: "none",
            color: "var(--text-3)",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Icon name="x" size={13} /> Clear selection
        </button>
      </div>
    </aside>
  );
}

// ============ Multi-run selection pane ============
export function RunSelectionPane({
  count,
  onClose,
  onClear,
  onDelete,
  onApprove,
  onDisapprove,
  onCancel,
  onRun,
}: {
  count: number;
  onClose: () => void;
  onClear: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onDisapprove: () => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <aside style={panelShell}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".7px",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Runs selected
        </span>
        <IconBtn
          name="panel-right"
          iconSize={15}
          size={22}
          title="Collapse panel"
          onClick={onClose}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: 18,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 46,
              height: 46,
              borderRadius: 10,
              background: "var(--surface-3)",
              color: "var(--text-2)",
              marginBottom: 12,
            }}
          >
            <Icon name="layers" size={22} />
          </span>
          <div
            className="metric"
            style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-.5px" }}
          >
            {count}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600 }}>
            runs selected
          </div>
        </div>

        <Btn variant="danger" size="lg" icon="trash" full onClick={onDelete}>
          Delete {count} {count === 1 ? "run" : "runs"}
        </Btn>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            textAlign: "center",
            margin: "8px 0 18px",
          }}
        >
          Removes the selected runs and their cached artifacts. Source PDFs are unaffected.
        </div>

        <SectionLabel>Other actions</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Btn variant="default" size="sm" icon="play" onClick={onRun}>
            Run / re-run
          </Btn>
          <Btn variant="default" size="sm" icon="stop" onClick={onCancel}>
            Cancel
          </Btn>
          <Btn variant="default" size="sm" icon="thumbsUp" onClick={onApprove}>
            Approve
          </Btn>
          <Btn variant="default" size="sm" icon="thumbsDown" onClick={onDisapprove}>
            Disapprove
          </Btn>
        </div>

        <button
          onClick={onClear}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            marginTop: 16,
            padding: "8px",
            background: "transparent",
            border: "none",
            color: "var(--text-3)",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Icon name="x" size={13} /> Clear selection
        </button>
      </div>
    </aside>
  );
}

// Dark backdrop shared by the compare-mode header and the paired-pages view, so
// the heading reads as part of the same dark pane as the PDF/Bloom columns below.
const COMPARE_BACKDROP = "#202124";

// Bright blue marks everything that comes from the source PDF — the "PDF" labels
// and the onion-skin tint — so the PDF layer reads as "blue" throughout the tab.
// Applied as a "screen"-blend overlay (not a hue-rotate filter): screen maps the
// PDF's black text → solid blue and white → white. A hue-rotate filter can't tint
// pure black (no chroma to rotate), so it leaves glyph bodies black and only blues
// the anti-aliased edges — text shows as a hollow outline. See the onion branch.
const PDF_BLUE = "#5b9bff";

// ============ PDF preview pane (far-right, collapsible + resizable) ============
type PagePairsInfo = {
  ready: boolean;
  reason?: string;
  pdfPages: number;
  bloomPages: number;
  // Explicit column alignment from the server: one entry per row. A null on either
  // side means that side has no counterpart (a blank/dropped source page, or a
  // Bloom-added xMatter page), so that cell renders as empty space.
  rows: { pdfPage: number | null; bloomPage: number | null }[];
  pageSize: string;
  bookReady: boolean;
};

// Page-pairs data + the Bloom (re-)processing action. Lifted out of
// PairedPagesView so the action button can live in the pane header (next to the
// close button) while the page grid renders in the body below.
function usePagePairs(runId?: string) {
  const [info, setInfo] = React.useState<PagePairsInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [processing, setProcessing] = React.useState(false);
  const [procError, setProcError] = React.useState<string | null>(null);
  // Bumped after Bloom re-processes the book so the page iframes reload the
  // now-styled HTML (same URL, new content).
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!runId) {
      setLoading(false);
      setInfo(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setInfo(null);
    api
      .pagePairs(runId)
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch(() => {
        if (alive) setInfo({ ready: false, reason: "Could not load this run's pages." } as any);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  const processInBloom = React.useCallback(() => {
    if (!runId) return;
    setProcessing(true);
    setProcError(null);
    api
      .processBook(runId)
      .then(() => api.pagePairs(runId))
      .then((r) => {
        setInfo(r);
        setReloadKey((k) => k + 1);
      })
      .catch((e) => setProcError(e?.message || "Processing failed."))
      .finally(() => setProcessing(false));
  }, [runId]);

  return { info, loading, processing, procError, reloadKey, processInBloom };
}

// Overlay/diff modes for the compare view. "off" = side-by-side (the default);
// "onion" = the PDF faded over the Bloom page (opacity slider); "diff" =
// mix-blend difference, so matching pixels go dark and any shift/resize glows.
type DiffMode = { mode: "off" | "onion" | "diff"; opacity: number };

export function PdfViewerPane({
  source,
  multiSelected,
  width,
  onResize,
  onClose,
  runId,
  mode = "pdf",
}: {
  source?: Source | null;
  multiSelected: boolean;
  width: number;
  onResize: (w: number) => void;
  onClose: () => void;
  runId?: string;
  mode?: "run" | "pdf";
}) {
  const pairs = usePagePairs(mode === "run" ? runId : undefined);
  const [diff, setDiff] = React.useState<DiffMode>({ mode: "off", opacity: 0.5 });
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      // handle is on the left edge: dragging left widens the pane. Cap only at the
      // viewport edge (less a sliver) so it can be dragged almost all the way left.
      const max = Math.max(260, window.innerWidth - 80);
      onResize(Math.max(260, Math.min(max, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const empty = (msg: string) => (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        color: "var(--text-3)",
        fontSize: 12.5,
      }}
    >
      {msg}
    </div>
  );

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        position: "relative",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{
          position: "absolute",
          left: -3,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: "col-resize",
          zIndex: 6,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px 10px",
          // In compare mode the header is part of the dark paired-pages pane.
          ...(mode === "run"
            ? { background: COMPARE_BACKDROP }
            : { borderBottom: "1px solid var(--border)" }),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* preview.svg (PDF→Bloom) in compare mode, pdf.svg in pure-PDF mode. */}
          <img
            src={mode === "run" ? "/preview.svg" : "/pdf.svg"}
            alt=""
            aria-hidden="true"
            style={{ height: mode === "run" ? 24 : 20, width: "auto", flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".7px",
                textTransform: "uppercase",
                color: mode === "run" ? "#bdc1c6" : "var(--text-3)",
              }}
            >
              {mode === "run" ? "Compare PDF to Bloom Version" : "PDF preview"}
            </span>
            {/* In compare mode the page rows are labelled themselves, so the book
              title under the heading would just be redundant. */}
            {mode !== "run" && source && !multiSelected && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {source.name}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {mode === "run" && pairs.info?.ready && (
            <Btn
              variant={pairs.info.bookReady ? "ghost" : "primary"}
              size="sm"
              icon={pairs.processing ? undefined : "refresh"}
              onClick={pairs.processInBloom}
              disabled={pairs.processing}
            >
              {pairs.processing
                ? "Processing in Bloom…"
                : pairs.info.bookReady
                  ? "Re-process in Bloom"
                  : "Process in Bloom"}
            </Btn>
          )}
          <IconBtn
            name="x"
            iconSize={15}
            size={22}
            title="Hide PDF preview"
            onClick={onClose}
            color={mode === "run" ? "#bdc1c6" : undefined}
          />
        </div>
      </div>
      {multiSelected ? (
        empty("Multiple PDFs selected — select a single PDF to preview it.")
      ) : mode === "run" && runId ? (
        <PairedPagesView
          runId={runId}
          paneWidth={width}
          info={pairs.info}
          loading={pairs.loading}
          processing={pairs.processing}
          procError={pairs.procError}
          reloadKey={pairs.reloadKey}
          diff={diff}
          onDiff={setDiff}
        />
      ) : source?.path ? (
        <iframe
          key={source.path}
          title="PDF preview"
          src={`/api/source-pdf?path=${encodeURIComponent(source.path)}`}
          style={{ flex: 1, width: "100%", border: "none", background: "var(--surface-2)" }}
        />
      ) : (
        empty("Select a PDF to preview it here.")
      )}
    </aside>
  );
}

// Page dimensions (mm) by Bloom page-size token, mirroring html-generator's
// pagePx(). Used to set the iframe's natural pixel size so we can scale it to fit
// the column. Falls back to A5 for unknown sizes.
const PAGE_DIMS_MM: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};
const MM_TO_PX = 96 / 25.4;

function pagePxSize(pageSize: string): { w: number; h: number } {
  const base = pageSize.replace(/(Portrait|Landscape)$/, "");
  const landscape = pageSize.endsWith("Landscape");
  const [shortMm, longMm] = PAGE_DIMS_MM[base] ?? PAGE_DIMS_MM.A5;
  const wMm = landscape ? longMm : shortMm;
  const hMm = landscape ? shortMm : longMm;
  return { w: Math.round(wMm * MM_TO_PX), h: Math.round(hMm * MM_TO_PX) };
}

/** True once `ref` has scrolled near the viewport; gates iframe loading. */
function useInView(ref: React.RefObject<HTMLElement>): boolean {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, inView]);
  return inView;
}

// ============ Paired per-page view (source PDF | resulting Bloom page) ============
// Shown in the PDF-preview pane when a conversion RUN is selected. Naïve index
// pairing: row i shows PDF page i and Bloom page i; whichever side runs out shows
// a placeholder (Bloom adds xMatter pages, so counts often differ).
function PairedPagesView({
  runId,
  paneWidth,
  info,
  loading,
  processing,
  procError,
  reloadKey,
  diff,
  onDiff,
}: {
  runId: string;
  paneWidth: number;
  info: PagePairsInfo | null;
  loading: boolean;
  processing: boolean;
  procError: string | null;
  reloadKey: number;
  diff: DiffMode;
  onDiff: (d: DiffMode) => void;
}) {
  const center = (msg: string) => (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        color: "var(--text-3)",
        fontSize: 12.5,
      }}
    >
      {msg}
    </div>
  );

  // Bloom is restyling the book — show a spinner over the dark backdrop until it
  // finishes (the pages then reload via reloadKey).
  if (processing)
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          background: COMPARE_BACKDROP,
          color: "#bdc1c6",
          fontSize: 12.5,
        }}
      >
        <div className="spinner" style={{ width: 34, height: 34, borderWidth: 3 }} />
        Processing in Bloom…
      </div>
    );

  if (loading) return center("Loading pages…");
  if (!info || !info.ready) return center(info?.reason || "No pages to show.");

  const { w: natW, h: natH } = pagePxSize(info.pageSize);
  const aspect = natW / natH;
  const rows = info.rows;

  // Dark backdrop so the white PDF/Bloom pages read as distinct cards floating on
  // a neutral surface, with clear separation between successive page rows.
  const BACKDROP = COMPARE_BACKDROP;

  // "PDF | Bloom" column banner, shown in side-by-side mode. Lives inside the
  // sticky header wrapper below, so the labels stay visible while paging down.
  const columnHeader = (
    <div style={{ display: "flex", gap: 8 }}>
      {[
        { label: "PDF", count: info.pdfPages },
        { label: "Bloom", count: info.bloomPages },
      ].map((c) => (
        <div
          key={c.label}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "baseline",
            justifyContent: "center",
            gap: 6,
            textAlign: "center",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: ".8px",
            textTransform: "uppercase",
            color: c.label === "PDF" ? PDF_BLUE : "#f1f1f1",
            padding: "6px 0",
            borderRadius: 5,
            background: "rgba(255,255,255,.05)",
          }}
        >
          {c.label}
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".3px", opacity: 0.7 }}>
            {c.count} pages
          </span>
        </div>
      ))}
    </div>
  );

  // Mode buttons + (for onion skin) the fade slider. Lets you flip the two pages
  // from side-by-side into a single overlaid box to spot drift directly.
  const diffBtn = (m: DiffMode["mode"], label: string, title: string) => (
    <button
      key={m}
      onClick={() => onDiff({ ...diff, mode: m })}
      title={title}
      style={{
        flex: 1,
        padding: "5px 8px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        border: "none",
        borderRadius: 5,
        background: diff.mode === m ? "var(--accent)" : "rgba(255,255,255,.06)",
        color: diff.mode === m ? "#fff" : "#cdd1d6",
      }}
    >
      {label}
    </button>
  );
  const diffControls = (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {diffBtn("off", "Side by side", "Show the PDF and Bloom pages in two columns")}
        {diffBtn("onion", "Onion skin", "Fade the PDF over the Bloom page")}
        {diffBtn("diff", "Difference", "Blend the two — matching pixels go dark, changes glow")}
      </div>
      {diff.mode === "onion" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px" }}>
          <span style={{ fontSize: 10, color: "#9aa0a6", whiteSpace: "nowrap" }}>Bloom</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={diff.opacity}
            onChange={(e) => onDiff({ ...diff, opacity: Number(e.target.value) })}
            style={{ flex: 1 }}
            aria-label="PDF / Bloom blend"
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: PDF_BLUE, whiteSpace: "nowrap" }}>
            PDF
          </span>
        </div>
      )}
    </div>
  );

  // In overlay modes the two-column banner makes no sense — the pages are stacked
  // into one box — so show a single explanatory caption instead.
  const overlayLabel = (
    <div
      style={{
        textAlign: "center",
        padding: "6px 0",
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: ".4px",
        color: "#f1f1f1",
        borderRadius: 5,
        background: "rgba(255,255,255,.05)",
      }}
    >
      {diff.mode === "onion" ? (
        <>
          <span style={{ color: PDF_BLUE }}>PDF</span> faded over Bloom
        </>
      ) : (
        "Difference — matching areas dark, changes glow"
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: BACKDROP, padding: "8px 10px 24px" }}>
      {procError && (
        <div
          style={{
            margin: "0 0 10px",
            padding: "7px 10px",
            borderRadius: 6,
            background: "var(--danger-bg, #fde8e8)",
            border: "1px solid var(--danger, #e06464)",
            color: "var(--danger, #b53d3d)",
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {procError}
        </div>
      )}
      {/* Until Bloom has styled the book there's nothing meaningful to compare, so
          we withhold both columns entirely and just prompt to process. */}
      {!info.bookReady ? (
        !procError && (
          <div
            style={{
              margin: "10px 0 0",
              padding: "14px 14px",
              borderRadius: 6,
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.12)",
              color: "#bdc1c6",
              fontSize: 12,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            Click <strong>Process in Bloom</strong> above to build the styled version, then compare
            it against the PDF here.
          </div>
        )
      ) : (
        <>
          {/* Sticky header: diff controls above, then the column banner (side-by-
              side) or overlay caption. Padding covers scrolling pages behind it. */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              background: BACKDROP,
              padding: "4px 0 10px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {diffControls}
            {diff.mode === "off" ? columnHeader : overlayLabel}
          </div>
          {rows.map((row, i) => (
            <PairedRow
              key={i}
              runId={runId}
              pdfPage={row.pdfPage}
              bloomPage={row.bloomPage}
              aspect={aspect}
              natW={natW}
              natH={natH}
              paneWidth={paneWidth}
              reloadKey={reloadKey}
              diff={diff}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PairedRow({
  runId,
  pdfPage,
  bloomPage,
  aspect,
  natW,
  natH,
  paneWidth,
  reloadKey,
  diff,
}: {
  runId: string;
  // Source-PDF page rendered on the left, and the Bloom page's document index
  // rendered on the right. Either may be null (no counterpart → empty cell).
  pdfPage: number | null;
  bloomPage: number | null;
  aspect: number;
  natW: number;
  natH: number;
  paneWidth: number;
  reloadKey: number;
  diff: DiffMode;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const colRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rowRef);
  const [colW, setColW] = React.useState(0);
  // Real rendered geometry of the visible .bloom-page, measured from the
  // (same-origin) iframe after load. natW/natH are only a guess from the page-
  // size token; the actual page can differ (wrong/missing token, body margins,
  // an unstyled book), so we scale from what's really on screen and translate
  // away any body offset. Null until first measured.
  const [measured, setMeasured] = React.useState<{
    w: number;
    h: number;
    left: number;
    top: number;
  } | null>(null);

  React.useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const measure = () => setColW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // diff.mode is a dep because the measured element (half-width column vs.
    // full-width overlay box) changes when toggling, so colW must re-measure.
  }, [paneWidth, diff.mode]);

  // Re-measure on reload (Bloom re-process swaps styled HTML in at the same URL).
  React.useEffect(() => setMeasured(null), [reloadKey]);

  const measureBloomPage = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument;
      const view = e.currentTarget.contentWindow;
      if (!doc || !view) return;
      const pages = Array.from(doc.querySelectorAll<HTMLElement>("body > .bloom-page"));
      const visible = pages.find((p) => view.getComputedStyle(p).display !== "none") ?? pages[0];
      if (!visible) return;
      const r = visible.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setMeasured({ w: r.width, h: r.height, left: r.left, top: r.top });
      }
    } catch {
      /* not ready or unreadable — keep the natW/natH guess */
    }
  };

  const colStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

  // Overlay only when both sides exist; a row missing a counterpart has nothing
  // to stack, so it falls back to the side-by-side (single-cell) layout.
  const overlay = diff.mode !== "off" && pdfPage !== null && bloomPage !== null;

  // The white page box that clips the scaled Bloom iframe. Reused by both layouts.
  const boxStyle: React.CSSProperties = {
    width: "100%",
    // Use the page's real aspect once measured; fall back to the page-size-token
    // guess so the box is roughly right pre-load.
    aspectRatio: String(measured ? measured.w / measured.h : aspect),
    overflow: "hidden",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "#fff",
    position: "relative",
  };

  const bloomIframe = inView && colW > 0 && bloomPage !== null && (
    <iframe
      key={reloadKey}
      title={`Bloom page ${bloomPage}`}
      src={api.bookPageUrl(runId, bloomPage, reloadKey)}
      scrolling="no"
      onLoad={measureBloomPage}
      style={{
        // Sized to contain the page (incl. any body offset); the container clips
        // the overflow. transform maps the page's real top-left to (0,0) and
        // scales it to the column width.
        position: "absolute",
        top: 0,
        left: 0,
        width: measured ? measured.left + measured.w : natW,
        height: measured ? measured.top + measured.h : natH,
        border: "none",
        transform: measured
          ? `scale(${colW / measured.w}) translate(${-measured.left}px, ${-measured.top}px)`
          : `scale(${colW / natW})`,
        transformOrigin: "top left",
        pointerEvents: "none",
      }}
    />
  );

  // PDF page, rendered for whichever layout/mode is active.
  const onImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.currentTarget as HTMLImageElement).style.display = "none";
  };
  const pdfSrc = pdfPage !== null ? api.pdfPageUrl(runId, pdfPage) : "";
  let pdfImg: React.ReactNode = null;
  if (pdfPage !== null && !overlay) {
    // Side-by-side: a plain, faithful block image of the source page.
    pdfImg = (
      <img
        src={pdfSrc}
        alt={`PDF page ${pdfPage}`}
        loading="lazy"
        style={{
          width: "100%",
          display: "block",
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}
        onError={onImgError}
      />
    );
  } else if (pdfPage !== null && diff.mode === "diff") {
    // Difference: blend straight over Bloom, untinted (a tint would make aligned
    // content glow). Fills the same box so page edges register.
    pdfImg = (
      <img
        src={pdfSrc}
        alt={`PDF page ${pdfPage}`}
        loading="lazy"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "fill",
          mixBlendMode: "difference",
          pointerEvents: "none",
        }}
        onError={onImgError}
      />
    );
  } else if (pdfPage !== null) {
    // Onion skin: tint the PDF blue, then fade the whole layer over Bloom. The blue
    // "screen" overlay sits on the PDF only — `isolation: isolate` keeps the blend
    // from reaching the Bloom iframe behind. opacity drives the fade.
    pdfImg = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: diff.opacity,
          isolation: "isolate",
          pointerEvents: "none",
        }}
      >
        <img
          src={pdfSrc}
          alt={`PDF page ${pdfPage}`}
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
          }}
          onError={onImgError}
        />
        <div
          style={{ position: "absolute", inset: 0, background: PDF_BLUE, mixBlendMode: "screen" }}
        />
      </div>
    );
  }

  return (
    <div ref={rowRef} style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".5px",
          color: "#9aa0a6",
          marginBottom: 4,
        }}
      >
        {pdfPage !== null ? `PAGE ${pdfPage}` : " "}
      </div>
      {overlay ? (
        // Stacked: Bloom underneath, PDF blended/faded on top, in one box.
        <div ref={colRef} style={{ width: "100%" }}>
          <div style={boxStyle}>
            {bloomIframe}
            {pdfImg}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div ref={colRef} style={colStyle}>
            {pdfImg}
          </div>
          <div style={colStyle}>
            {bloomPage !== null && <div style={boxStyle}>{bloomIframe}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
