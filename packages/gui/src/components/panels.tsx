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
import { api } from "../api";

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
  onCompare: (s: Source) => void;
  onDelete: (sid: string, rid: string) => void;
  onNotes: (sid: string, rid: string, patch: Partial<Run>) => void;
  onCancel: (sid: string, rid: string) => void;
}) {
  const [tab, setTab] = React.useState("artifacts");
  React.useEffect(() => {
    setTab("artifacts");
  }, [run && run.id]);

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
              <StatusPill status={effStatus(run)} />
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

        {/* notes */}
        <NotesTags run={run} source={source} onNotes={onNotes} />
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
        {[
          ["artifacts", "Artifacts"],
          ["details", "Settings"],
          ["metrics", "Metrics"],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            style={{
              position: "relative",
              padding: "7px 11px 9px",
              border: "none",
              background: "transparent",
              fontSize: 12,
              fontWeight: 600,
              color: tab === v ? "var(--text)" : "var(--text-3)",
              cursor: "pointer",
            }}
          >
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
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "details" && <DetailsTab run={run} source={source} />}
        {tab === "metrics" && <MetricsTab run={run} />}
        {tab === "artifacts" && <ArtifactsTab run={run} />}
      </div>
    </aside>
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
          Failed at {BLOOM.STAGE_LABELS[error.stage]} stage
        </span>
        <code className="mono" style={{ marginLeft: "auto", fontSize: 9.5, opacity: 0.8 }}>
          {error.code}
        </code>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--text-2)", margin: "0 0 7px", lineHeight: 1.5 }}>
        {error.message}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          fontSize: 11,
          color: "var(--text-2)",
          background: "var(--surface)",
          padding: "7px 9px",
          borderRadius: 5,
        }}
      >
        <Icon name="info" size={13} style={{ marginTop: 1, color: "var(--accent)" }} />
        <span>{error.hint}</span>
      </div>
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

// notes block (lives at top of run detail)
function NotesTags({
  run,
  source,
  onNotes,
}: {
  run: Run;
  source: Source;
  onNotes: (sid: string, rid: string, patch: Partial<Run>) => void;
}) {
  return (
    <div style={{ marginTop: 11 }}>
      <textarea
        value={run.notes}
        onChange={(e) => onNotes(source.id, run.id, { notes: e.target.value })}
        placeholder="Add a note about this run…"
        style={{
          width: "100%",
          minHeight: 38,
          resize: "vertical",
          padding: "7px 9px",
          fontSize: 12,
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
    L.push(`- FAILED at ${BLOOM.STAGE_LABELS[run.error.stage]} stage`);
    L.push(`  - Error code: ${run.error.code}`);
    L.push(`  - Message: ${run.error.message}`);
    L.push(`  - Suggested fix: ${run.error.hint}`);
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
        `| ${BLOOM.STAGE_LABELS[b.stage]} | ${b.dur} | ${b.tin} | ${b.tout} | ${fmt.cost(b.cost)} |`,
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
export function ParamControls({
  params: p,
  onChange: set,
}: {
  params: Params;
  onChange: (k: keyof Params, v: any) => void;
}) {
  return (
    <React.Fragment>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <Field label="OCR method">
          <Select
            full
            value={p.ocrMethod}
            onChange={(v) => set("ocrMethod", v)}
            options={Object.entries(BLOOM.ocrMethods).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="LLM model">
          <Select
            full
            value={p.model}
            onChange={(v) => set("model", v)}
            options={Object.entries(BLOOM.MODELS).map(([value, m]) => ({ value, label: m.label }))}
          />
        </Field>
        <Field label="Cover handling">
          <Select
            full
            value={p.coverMode}
            onChange={(v) => set("coverMode", v)}
            options={Object.entries(BLOOM.coverModes).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Target output">
          <Select
            full
            value={p.target}
            onChange={(v) => set("target", v)}
            options={BLOOM.targetOrder.map((v) => ({ value: v, label: BLOOM.targets[v] }))}
          />
        </Field>
      </div>
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
      <div
        style={{
          paddingBottom: 4,
          opacity: p.visionFormatting ? 1 : 0.45,
          pointerEvents: p.visionFormatting ? "auto" : "none",
        }}
      >
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
            options={Object.entries(BLOOM.MODELS).map(([value, m]) => ({ value, label: m.label }))}
          />
        </Field>
      </div>
      <div style={{ padding: "12px 0 4px", borderTop: "1px solid var(--border)" }}>
        <Field
          label={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              Complex page → flatten as image{" "}
              <InfoDot tip="When a page is too complex to rebuild as editable HTML, import it as a single full-page image. Lower numbers flatten more readily; 0 flattens every canvas page; off never does." />
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
    { value: "recent", label: "Use running Bloom (recent)" },
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
}: {
  source: Source;
  defaultParams?: Params;
  parallelism: number;
  collection: string;
  onCollection: (v: string) => void;
  collections: { path: string; name: string }[];
  onClose: () => void;
  onRunNow: (params: Params) => void;
  onSelectRun?: (sid: string, rid: string) => void;
  onMark?: (sid: string, rid: string, v: Mark) => void;
}) {
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
        {/* prominent run */}
        <Btn variant="primary" size="lg" icon="play" full onClick={() => onRunNow(params)}>
          Run conversion
        </Btn>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            textAlign: "center",
            margin: "7px 0 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
          }}
        >
          <Icon name="info" size={12} />
          Runs with the settings below · queues if &gt; {parallelism} active
        </div>

        {/* target collection + raw settings */}
        <SectionLabel>Conversion settings</SectionLabel>
        <div style={{ marginBottom: 12 }}>
          <CollectionPicker value={collection} onChange={onCollection} collections={collections} />
        </div>
        <ParamControls params={params} onChange={set} />
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
        <ParamControls params={params} onChange={set} />

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
