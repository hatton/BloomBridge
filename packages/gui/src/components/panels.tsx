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
  StageBadges,
  ProgressBar,
  runProgress,
  fmt,
  STATUS_META,
} from "./primitives";
import type {
  ArtifactNode,
  ChecklistMark,
  MetadataItem,
  Params,
  Run,
  Source,
  Stage,
} from "../types";
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
  const browse = async () => {
    const { path } = await api.pickFolder(folder || undefined);
    if (path) onPick(path);
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

      {/* folder chooser */}
      <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid var(--border)" }}>
        <Btn variant="primary" size="sm" icon="folder-open" onClick={browse} full>
          Choose folder…
        </Btn>
        {folder && (
          <div
            className="mono"
            title={folder}
            style={{
              marginTop: 8,
              fontSize: 10.5,
              color: "var(--text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
            }}
          >
            {folder}
          </div>
        )}
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

// ---------- Log tab (live conversion log) ----------
export function LogTab({ run }: { run: Run }) {
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

export function ErrorBanner({ error }: { error: NonNullable<Run["error"]> }) {
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

export function DetailsTab({ run, source }: { run: Run; source: Source }) {
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
export function NotesTab({
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
export function MetricsTab({ run }: { run: Run }) {
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
export function ArtifactsTab({ run }: { run: Run }) {
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
    "bloombridge " +
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
    (p.complexBecomesImage !== "busy"
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

export function CopyRunButton({ source, run }: { source: Source; run: Run }) {
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

// A row of stage pills heading a group of settings. Each pill names a pipeline
// stage the settings below affect; a multi-stage setting shows several pills.
function StagePills({ stages }: { stages: Stage[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 9 }}>
      {stages.map((s) => (
        <span
          key={s}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 18,
            padding: "0 8px",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".4px",
            background: "var(--st-done-bg)",
            color: "var(--st-done-fg)",
          }}
        >
          {BLOOM.STAGE_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

// One stage-keyed group of settings: a pill row, then its controls.
function StageGroup({
  stages,
  first,
  children,
}: {
  stages: Stage[];
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        paddingTop: first ? 0 : 14,
        marginTop: first ? 0 : 14,
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <StagePills stages={stages} />
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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  return (
    <React.Fragment>
      {/* ---- Primary control: translatability vs. fidelity (no stage pill) ---- */}
      <Changed on={chg("complexBecomesImage")}>
        <Field
          label={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              Translatability vs. Fidelity{" "}
              <InfoDot tip="'Only image covers' rebuilds every interior page as editable text; 'pages too busy to convert well' (default) also snapshots genuinely busy layouts; 'any page with text over a picture' snapshots every canvas page; 'All pages' snapshots everything for maximum fidelity (nothing editable; only a few pages are OCR'd for metadata/languages)." />
            </span>
          }
        >
          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 7, lineHeight: 1.45 }}>
            Without a human touching things up, this converter can&apos;t always reproduce a complex
            page exactly using editable text boxes. For which pages should it just snapshot the
            original PDF page instead?
          </div>
          <Select
            full
            value={p.complexBecomesImage}
            onChange={(v) => set("complexBecomesImage", v)}
            options={BLOOM.complexOrder.map((v) => ({ value: v, label: BLOOM.complexLevels[v] }))}
          />
        </Field>
      </Changed>

      {/* ---- Everything else, collapsed under "Advanced" ---- */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 18,
          padding: "6px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-2)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            transform: advancedOpen ? "rotate(90deg)" : "none",
            transition: "transform .12s",
            display: "inline-flex",
          }}
        >
          <Icon name="chevron" size={11} />
        </span>
        Advanced
      </button>
      {advancedOpen && (
        <React.Fragment>
          {/* ---- OCR stage ---- */}
          <StageGroup stages={["ocr"]} first>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Changed on={chg("ocrMethod")}>
                <Field label="OCR method">
                  <Select
                    full
                    value={p.ocrMethod}
                    onChange={(v) => set("ocrMethod", v)}
                    options={Object.entries(BLOOM.ocrMethods).map(([value, label]) => ({
                      value,
                      label,
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
                    options={Object.entries(BLOOM.coverModes).map(([value, label]) => ({
                      value,
                      label,
                    }))}
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
                  marginTop: 4,
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
          </StageGroup>

          {/* ---- Think (LLM) stage ---- */}
          <StageGroup stages={["llm"]}>
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
          </StageGroup>

          {/* ---- Affects the whole pipeline: where to stop ---- */}
          <StageGroup stages={["ocr", "llm", "plan", "html"]}>
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
          </StageGroup>
        </React.Fragment>
      )}
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

// ============ Batch pane (multiple PDFs selected) ============
export function BatchPane({
  count,
  parallelism,
  defaultParams,
  onClose,
  onClear,
  onRun,
}: {
  count: number;
  parallelism: number;
  defaultParams?: Params;
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

        {/* Collection picker hidden: targeting other collections isn't supported yet. */}
        <SectionLabel>Conversion settings for all</SectionLabel>
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
  /** Whether the left column shows PDF page renders or EPUB illustrations. */
  sourceKind?: "pdf" | "epub";
  pdfPages: number;
  bloomPages: number;
  /** Formatted total size of the Bloom book folder (e.g. "2.3 MB"). */
  bloomSize?: string;
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
function usePagePairs(runId?: string, runStatus?: string) {
  const [info, setInfo] = React.useState<PagePairsInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [processing, setProcessing] = React.useState(false);
  const [procError, setProcError] = React.useState<string | null>(null);
  // Bumped after Bloom re-processes the book so the page iframes reload the
  // now-styled HTML (same URL, new content).
  const [reloadKey, setReloadKey] = React.useState(0);

  // Re-fetch on runId change (reset the view) and whenever the run's status changes
  // (e.g. the final Bloom stage finishes → the styled book is now ready to show). We
  // only blank the view when the run itself changes, so a status-driven re-fetch
  // doesn't flicker.
  const lastRunId = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!runId) {
      setLoading(false);
      setInfo(null);
      lastRunId.current = undefined;
      return;
    }
    let alive = true;
    if (lastRunId.current !== runId) {
      lastRunId.current = runId;
      setLoading(true);
      setInfo(null);
    }
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
  }, [runId, runStatus]);

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

// View modes for the compare pane. "side" = source and Bloom side-by-side (the
// default); "super" = the source faded over the Bloom page (opacity slider),
// toggled by the Superimpose checkbox. `metadata` drops the extracted-metadata
// review panel over the Bloom side (independent of side/super).
type ViewMode = { mode: "side" | "super"; opacity: number; metadata: boolean };

export function PdfViewerPane({
  source,
  multiSelected,
  width,
  onResize,
  runId,
  mode = "pdf",
  runStatus,
  runStage,
  runFailedStage,
  showActions,
  hasRun,
  onRunNow,
  onOpenSettings,
  onOpenDetails,
  bloomRunning = false,
  bloomCollectionName,
}: {
  source?: Source | null;
  multiSelected: boolean;
  width: number;
  onResize: (w: number) => void;
  runId?: string;
  mode?: "run" | "pdf";
  // Live status + current stage of the previewed run, so the compare pane can re-fetch
  // when the run finishes and show a "processing" state during the final Bloom stage.
  runStatus?: string;
  runStage?: string;
  // The stage a failed run died on, so the Bloom-side placeholder can name it.
  runFailedStage?: Stage;
  // Whether a single source is in focus, so the Run-conversion / settings / details
  // controls in the header apply. `hasRun` gates the details button (needs a run).
  showActions?: boolean;
  hasRun?: boolean;
  onRunNow?: () => void;
  onOpenSettings?: () => void;
  onOpenDetails?: () => void;
  // Live Bloom connection, surfaced beside the "Convert to Bloom" action in the body.
  bloomRunning?: boolean;
  bloomCollectionName?: string;
}) {
  const pairs = usePagePairs(mode === "run" ? runId : undefined, runStatus);
  // The run is in its final Bloom stage — Bloom is styling the book. Surface the same
  // "Processing in Bloom…" spinner the manual re-process uses, until the run completes
  // and the re-fetch above swaps in the side-by-side comparison.
  const autoProcessing = mode === "run" && runStatus === "running" && runStage === "bloom";
  // EPUB sources have no fixed-page PDF to embed; the compare view shows the spine
  // illustrations instead, and the raw-preview iframe is replaced by a note.
  const isEpub =
    /\.epub$/i.test(source?.file || source?.path || "") || pairs.info?.sourceKind === "epub";
  const [view, setView] = React.useState<ViewMode>({ mode: "side", opacity: 0.5, metadata: false });
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    // mousemove fires far more often than once per frame; coalesce to one
    // onResize (one parent re-render) per animation frame so a fast drag doesn't
    // queue a backlog of re-renders behind the cursor.
    let raf = 0;
    let pending = startW;
    const flush = () => {
      raf = 0;
      onResize(pending);
    };
    const onMove = (ev: MouseEvent) => {
      // handle is on the left edge: dragging left widens the pane. Cap only at the
      // viewport edge (less a sliver) so it can be dragged almost all the way left.
      const max = Math.max(260, window.innerWidth - 80);
      pending = Math.max(260, Math.min(max, startW + (startX - ev.clientX)));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      if (raf) cancelAnimationFrame(raf);
      onResize(pending); // commit the final position
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
      {/* Pane header: a controls row, plus (in compare mode) the column headings, so
          the headings read as part of this same surface rather than floating over the
          scrolling pages below. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          // Horizontal padding matches the scrolling rows below so the column
          // headings line up with the page columns.
          padding: "11px 10px 10px",
          ...(mode === "run"
            ? { background: COMPARE_BACKDROP }
            : { borderBottom: "1px solid var(--border)" }),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            rowGap: 6,
          }}
        >
          {/* The run-conversion call-to-action lives in the body's Bloom slot; the
              header keeps quiet re-run / re-process buttons once a run exists. */}
          {showActions && hasRun && (
            <Btn
              variant="ghost"
              size="sm"
              icon="play"
              onClick={onRunNow}
              title="Re-run a conversion with the current settings"
            >
              Re-Run Conversion
            </Btn>
          )}
          {mode === "run" && pairs.info?.ready && pairs.info.bookReady && (
            <Btn
              variant="ghost"
              size="sm"
              icon={pairs.processing ? undefined : "refresh"}
              onClick={pairs.processInBloom}
              disabled={pairs.processing}
            >
              {pairs.processing ? "Processing…" : "Re-process"}
            </Btn>
          )}
          {showActions && (
            <IconBtn
              name="sliders"
              iconSize={15}
              size={26}
              title="Conversion settings"
              onClick={onOpenSettings}
              color={mode === "run" ? "#bdc1c6" : undefined}
            />
          )}
          {hasRun && (
            <IconBtn
              name="external"
              iconSize={15}
              size={26}
              title="Run details (log, artifacts, metrics, notes)"
              onClick={onOpenDetails}
              color={mode === "run" ? "#bdc1c6" : undefined}
            />
          )}
        </div>
        {mode === "run" && pairs.info?.ready && (
          <CompareHeadings
            info={pairs.info}
            sourceSize={source?.size}
            view={view}
            onView={setView}
          />
        )}
      </div>
      {multiSelected ? (
        empty("Multiple PDFs selected — select a single PDF to preview it.")
      ) : mode === "run" && runId ? (
        <PairedPagesView
          runId={runId}
          info={pairs.info}
          loading={pairs.loading}
          processing={pairs.processing || autoProcessing}
          procError={pairs.procError}
          reloadKey={pairs.reloadKey}
          onProcess={pairs.processInBloom}
          runStatus={runStatus}
          runStage={runStage}
          runFailedStage={runFailedStage}
          onOpenDetails={onOpenDetails}
          bloomRunning={bloomRunning}
          bloomCollectionName={bloomCollectionName}
          view={view}
          onCloseMetadata={() => setView((v) => ({ ...v, metadata: false }))}
        />
      ) : source?.path ? (
        // A book with no run: mirror the paired view's two columns — the source
        // (PDF/EPUB) on the left, a "no Bloom book yet" placeholder where the
        // converted book will eventually appear.
        <SourceOnlyPane
          source={source}
          isEpub={isEpub}
          onRunNow={showActions ? onRunNow : undefined}
          bloomRunning={bloomRunning}
          bloomCollectionName={bloomCollectionName}
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

// "13 pages, 1.2 MB" — the lighter sub-label beside a column heading. Either part
// may be missing (unknown page count / size); we join only what we have.
function sourceMeta(pages?: number, size?: string): string {
  const parts: string[] = [];
  if (pages && pages > 0) parts.push(`${pages} page${pages === 1 ? "" : "s"}`);
  if (size) parts.push(size);
  return parts.join(", ");
}

// A column heading for the compare pane: a bold label (EPUB/PDF, Bloom) with a
// lighter sub-label after it (page count / size), plus optional right-aligned
// controls (the superimpose toggle lives in the Bloom heading).
function CompareColHeader({
  label,
  sub,
  right,
}: {
  label: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#e8eaed", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {sub && (
        <span
          style={{
            fontSize: 11,
            color: "#9aa0a6",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </span>
      )}
      {right && <div style={{ marginLeft: "auto", flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// The card shown in the Bloom column when there's no Bloom page to render yet
// (converting / failed / not-yet-styled). Centered title + optional spinner,
// sub-text and action button; `danger` paints it in the alert color.
function NoticeCard({
  title,
  subtitle,
  danger,
  spinner,
  statusLine,
  action,
}: {
  title: string;
  subtitle?: string;
  danger?: boolean;
  spinner?: boolean;
  // Optional element shown just above the action button (the Bloom connection pill).
  statusLine?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 12,
        padding: "28px 18px",
        borderRadius: 6,
        border: `1px solid ${danger ? "var(--st-fail-fg)" : "rgba(255,255,255,.14)"}`,
        background: danger ? "rgba(229,90,90,.12)" : "rgba(255,255,255,.04)",
        minHeight: 120,
      }}
    >
      {spinner && <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />}
      <div
        style={{ fontSize: 13, fontWeight: 700, color: danger ? "var(--st-fail-fg)" : "#e8eaed" }}
      >
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11.5, color: "#9aa0a6", lineHeight: 1.4 }}>{subtitle}</div>
      )}
      {statusLine}
      {action}
    </div>
  );
}

// Live Bloom connection indicator. Lives just above the "Convert to Bloom" action so
// the state of the thing you're about to use is right there: a quiet pill when
// connected, a prominent alert pill when not (nothing converts/renders without a
// running Bloom). Styled for the dark compare backdrop.
function BloomConnPill({ running, collectionName }: { running: boolean; collectionName?: string }) {
  return (
    <span
      title={
        running
          ? "Connected to a running Bloom with this collection open"
          : "Not connected to a running Bloom"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 24,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${running ? "rgba(255,255,255,.18)" : "var(--st-fail-fg)"}`,
        background: running ? "rgba(255,255,255,.06)" : "var(--st-fail-bg)",
        fontSize: 11,
        fontWeight: running ? 600 : 700,
        color: running ? "#bdc1c6" : "var(--st-fail-fg)",
        maxWidth: 240,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          flexShrink: 0,
          background: running ? "var(--st-done-fg)" : "var(--st-fail-fg)",
        }}
      />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {running ? `Bloom connected: ${collectionName || "running"}` : "Bloom not connected"}
      </span>
    </span>
  );
}

// Source-only compare view: shown when a book with no run is selected. The source
// (PDF/EPUB) fills the left column and a "no Bloom book yet" placeholder sits where
// the converted book will go, mirroring the paired run view's two-column layout.
function SourceOnlyPane({
  source,
  isEpub,
  onRunNow,
  bloomRunning,
  bloomCollectionName,
}: {
  source: Source;
  isEpub: boolean;
  onRunNow?: () => void;
  bloomRunning: boolean;
  bloomCollectionName?: string;
}) {
  const srcLabel = isEpub ? "EPUB" : "PDF";
  // PDF: the whole document in the browser's PDF viewer. EPUB (no run yet): the cover
  // spine page via the resource proxy — the standalone multi-page reader is retired.
  const srcUrl = isEpub
    ? api.epubSpineUrlByPath(source.path || "", 1)
    : `/api/source-pdf?path=${encodeURIComponent(source.path || "")}`;
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: COMPARE_BACKDROP,
      }}
    >
      <div style={{ display: "flex", gap: 8, padding: "12px 12px 10px" }}>
        <CompareColHeader label={srcLabel} sub={sourceMeta(source.pages, source.size)} />
        <CompareColHeader label="Bloom" />
      </div>
      <div style={{ flex: 1, display: "flex", gap: 8, padding: "0 12px 12px", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <iframe
            key={source.path}
            title={`${srcLabel} preview`}
            src={srcUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "#fff",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <NoticeCard
            title="No Bloom book yet"
            statusLine={
              <BloomConnPill running={bloomRunning} collectionName={bloomCollectionName} />
            }
            action={
              onRunNow && (
                <Btn variant="primary" size="sm" icon="play" onClick={onRunNow}>
                  Convert to Bloom
                </Btn>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

// The two bold column headings (EPUB/PDF · Bloom) with their lighter page/size
// sub-labels, plus the Superimpose toggle parked on the right (Bloom) heading and
// the blend slider beneath when active. Rendered in the pane header so it reads as
// one surface with the Re-run / Re-process controls (not floating over the pages).
function CompareHeadings({
  info,
  sourceSize,
  view,
  onView,
}: {
  info: PagePairsInfo;
  sourceSize?: string;
  view: ViewMode;
  onView: (d: ViewMode) => void;
}) {
  const srcLabel = info.sourceKind === "epub" ? "EPUB" : "PDF";
  const toggleStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    fontWeight: 600,
    color: "#bdc1c6",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
  // "Review Checklist" (review the extracted metadata against the source) sits to the
  // LEFT of "Superimpose". A plain toggle button, available whenever the source is
  // ready — even before Bloom has styled the book — so it can be reviewed early.
  const reviewBtn = (
    <button
      onClick={() => onView({ ...view, metadata: !view.metadata })}
      title="Review the extracted metadata against the source document"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 11px",
        borderRadius: 999,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontSize: 11.5,
        fontWeight: 600,
        border: `1px solid ${view.metadata ? "var(--accent)" : "rgba(255,255,255,.22)"}`,
        background: view.metadata ? "var(--accent)" : "rgba(255,255,255,.06)",
        color: view.metadata ? "#fff" : "#bdc1c6",
      }}
    >
      <Icon name="check" size={13} />
      Review Checklist
    </button>
  );
  const superToggle = (
    <label style={toggleStyle}>
      <input
        type="checkbox"
        checked={view.mode === "super"}
        onChange={(e) => onView({ ...view, mode: e.target.checked ? "super" : "side" })}
      />
      Superimpose
    </label>
  );
  const controls = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      {reviewBtn}
      {info.bookReady && superToggle}
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <CompareColHeader label={srcLabel} sub={sourceMeta(info.pdfPages, sourceSize)} />
        <CompareColHeader
          label="Bloom"
          sub={info.bloomPages > 0 ? sourceMeta(info.bloomPages, info.bloomSize) : undefined}
          right={controls}
        />
      </div>
      {info.bookReady && view.mode === "super" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 2px" }}>
          <span style={{ fontSize: 10, color: "#9aa0a6", whiteSpace: "nowrap" }}>Bloom</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={view.opacity}
            onChange={(e) => onView({ ...view, opacity: Number(e.target.value) })}
            style={{ flex: 1 }}
            aria-label={`${srcLabel} / Bloom blend`}
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: PDF_BLUE, whiteSpace: "nowrap" }}>
            {srcLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// ============ Paired per-page view (source PDF | resulting Bloom page) ============
// Shown in the PDF-preview pane when a conversion RUN is selected. Naïve index
// pairing: row i shows PDF page i and Bloom page i; whichever side runs out shows
// a placeholder (Bloom adds xMatter pages, so counts often differ).
function PairedPagesView({
  runId,
  info,
  loading,
  processing,
  procError,
  reloadKey,
  onProcess,
  runStatus,
  runStage,
  runFailedStage,
  onOpenDetails,
  bloomRunning,
  bloomCollectionName,
  view,
  onCloseMetadata,
}: {
  runId: string;
  info: PagePairsInfo | null;
  loading: boolean;
  processing: boolean;
  procError: string | null;
  reloadKey: number;
  onProcess: () => void;
  // Run lifecycle, so the Bloom-side placeholder can explain why there's no Bloom
  // page yet (converting / failed-on-step / not-yet-rendered) when bookReady is false.
  runStatus?: string;
  runStage?: string;
  runFailedStage?: Stage;
  onOpenDetails?: () => void;
  // Live Bloom connection, shown above the "Convert to Bloom" placeholder action.
  bloomRunning: boolean;
  bloomCollectionName?: string;
  view: ViewMode;
  // Turn the metadata-review panel off (its "×" button) — owned by PdfViewerPane.
  onCloseMetadata?: () => void;
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

  // When the book isn't styled yet there's nothing to render in the Bloom column.
  // Instead of withholding both sides, we keep the source pages on the left and
  // drop a single notice into the top of the Bloom column explaining why — and, when
  // actionable, a button (convert in Bloom, or open the failed run's details).
  const stageName = (s?: string) => (s && BLOOM.STAGE_LABELS[s as Stage]) || s || "";
  const bloomNotice = info.bookReady ? null : runStatus === "failed" ? (
    <NoticeCard
      danger
      title={
        stageName(runFailedStage)
          ? `Conversion failed on the ${stageName(runFailedStage)} step`
          : "Conversion failed"
      }
      action={
        onOpenDetails && (
          <Btn variant="default" size="sm" icon="external" onClick={onOpenDetails}>
            Open run details
          </Btn>
        )
      }
    />
  ) : runStatus === "running" || runStatus === "queued" ? (
    <NoticeCard
      spinner
      title={runStatus === "queued" ? "Queued for conversion…" : "Converting…"}
      subtitle={stageName(runStage) ? `Current step: ${stageName(runStage)}` : undefined}
    />
  ) : info.bloomPages > 0 ? (
    <NoticeCard
      title="Not yet rendered by Bloom"
      subtitle="Send this book to the running Bloom to apply its page styling."
      statusLine={<BloomConnPill running={bloomRunning} collectionName={bloomCollectionName} />}
      action={
        <Btn variant="primary" size="sm" icon="refresh" onClick={onProcess}>
          Convert to Bloom
        </Btn>
      }
    />
  ) : (
    <NoticeCard
      danger
      title="No Bloom output was produced"
      action={
        onOpenDetails && (
          <Btn variant="default" size="sm" icon="external" onClick={onOpenDetails}>
            Open run details
          </Btn>
        )
      }
    />
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background: BACKDROP,
          padding: "8px 10px 24px",
        }}
      >
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
        {/* Column headings live in the pane header (CompareHeadings) so they read as one
            surface with the controls; here we render just the scrolling page rows. */}
        {rows.map((row, i) => (
          <PairedRow
            key={i}
            runId={runId}
            pdfPage={row.pdfPage}
            bloomPage={row.bloomPage}
            sourceKind={info.sourceKind === "epub" ? "epub" : "pdf"}
            aspect={aspect}
            natW={natW}
            natH={natH}
            reloadKey={reloadKey}
            view={view}
            // The Bloom-side placeholder rides in the first row only, so it appears
            // once at the top of the Bloom column while the source pages flow below.
            bloomNotice={i === 0 ? bloomNotice : null}
          />
        ))}
      </div>
      {/* Extracted-metadata review panel, dropped over the Bloom (right) side. */}
      {view.metadata && <MetadataOverlay runId={runId} onClose={onCloseMetadata} />}
    </div>
  );
}

// One thumbs-up / thumbs-down button in the metadata review panel. Active marks are
// filled (green / red); clicking the active mark clears it.
function ThumbBtn({
  dir,
  active,
  onClick,
}: {
  dir: "up" | "down";
  active: boolean;
  onClick: () => void;
}) {
  const good = dir === "up";
  const accent = good ? "var(--good)" : "var(--bad)";
  return (
    <button
      onClick={onClick}
      title={good ? "Looks right" : "Has a problem"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 7,
        cursor: "pointer",
        border: `1px solid ${active ? accent : "rgba(255,255,255,.18)"}`,
        background: active
          ? `color-mix(in oklch, ${accent} 28%, transparent)`
          : "rgba(255,255,255,.04)",
        color: active ? accent : "#bdc1c6",
      }}
    >
      <Icon name={good ? "thumbsUp" : "thumbsDown"} size={14} strokeWidth={2} />
    </button>
  );
}

// The extracted-metadata review panel, dropped over the Bloom (right) half of the
// compare pane. Lists every checklist item with the value we extracted (or "(not
// detected)") and a thumbs-up / thumbs-down control per item. Marks persist to the
// run (the table's Status column reflects them via the SSE run-update).
function MetadataOverlay({ runId, onClose }: { runId: string; onClose?: () => void }) {
  const [items, setItems] = React.useState<MetadataItem[] | null>(null);
  const [marks, setMarks] = React.useState<Record<string, ChecklistMark>>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .runMetadata(runId)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setMarks(r.marks || {});
      })
      .catch(() => {
        if (alive) setItems([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  // Toggle a mark: clicking the active one clears it. Optimistic; writes through to
  // the server, which broadcasts the run-update that keeps the table in sync.
  const setMark = (key: string, mark: ChecklistMark) => {
    setMarks((prev) => {
      const next = { ...prev };
      const newMark = prev[key] === mark ? null : mark;
      if (newMark) next[key] = newMark;
      else delete next[key];
      api.setChecklistMark(runId, key, newMark).catch(() => {});
      return next;
    });
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        left: "50%",
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        background: COMPARE_BACKDROP,
        borderLeft: "1px solid rgba(255,255,255,.12)",
        boxShadow: "-8px 0 24px rgba(0,0,0,.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".5px",
            textTransform: "uppercase",
            color: "#e8eaed",
          }}
        >
          Conversion Review Checklist
        </span>
        {onClose && (
          <IconBtn
            name="x"
            size={24}
            iconSize={14}
            title="Close review checklist"
            color="#bdc1c6"
            onClick={onClose}
          />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 12px 14px" }}>
        {loading ? (
          <div style={{ color: "#9aa0a6", fontSize: 12, padding: "16px 2px" }}>Loading…</div>
        ) : !items || items.length === 0 ? (
          <div style={{ color: "#9aa0a6", fontSize: 12, padding: "16px 2px", lineHeight: 1.5 }}>
            No metadata available for this run yet.
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "9px 0",
                borderBottom: "1px solid rgba(255,255,255,.07)",
              }}
            >
              {/* Thumbs first (left) column. */}
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <ThumbBtn
                  dir="up"
                  active={marks[it.key] === "up"}
                  onClick={() => setMark(it.key, "up")}
                />
                <ThumbBtn
                  dir="down"
                  active={marks[it.key] === "down"}
                  onClick={() => setMark(it.key, "down")}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".4px",
                    textTransform: "uppercase",
                    color: "#9aa0a6",
                    marginBottom: 3,
                  }}
                >
                  {it.label}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: it.value ? "#e8eaed" : "#7a7f86",
                    fontStyle: it.value ? "normal" : "italic",
                    wordBreak: "break-word",
                    lineHeight: 1.4,
                  }}
                >
                  {it.value || "(not detected)"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Author-defense CSS injected into each previewed EPUB page — the single seam where a
// reader's normalization lives. Today it just restores image aspect (books set
// `img{width:..%;height:..%}` with no object-fit, which stretches a logo); swapping in
// the full ReadiumCSS sheet later is a one-line change here.
// Injected into the preview iframe after load. The img rule keeps illustrations from
// being squashed by their authored fixed heights. The line-height rule undoes a
// StoryWeaver editor-CSS quirk: under its narrow-viewport media queries the matter
// pages' text is collapsed to a near-zero line-height (e.g. `line-height:0.1em` on a
// landscape `.content`, `0.3em` on `.content p`), so the credits/attribution pages
// otherwise render as overlapping, illegible text. Scoped to StoryWeaver's
// `#selected_page` so it can't affect other EPUBs.
const EPUB_PREVIEW_CSS =
  "img{height:auto!important;object-fit:contain!important;}" +
  "#selected_page .content,#selected_page .content *{line-height:1.4!important;}";

// One source EPUB spine page in the compare grid's left column. A reflowable EPUB page
// is just a web page, so we load its real document from the resource proxy (its own
// fonts/images/CSS resolve under that prefix), let it lay out at a nominal page width,
// then — once web-fonts have loaded — measure its true content height and scale the whole
// page uniformly to fit the book-page box. Nothing is clipped; an image-only page fills
// the box, a caption page shows all its text. (Port of test-outputs/epub-proof shootFit.)
const EpubPageCell = React.memo(function EpubPageCell({
  runId,
  page,
  reloadKey,
  natW,
  natH,
  aspect,
}: {
  runId: string;
  page: number;
  reloadKey: number;
  // The book's page geometry (same values the Bloom column uses), so every source
  // page is shown in a uniform book-page box that lines up with its Bloom counterpart.
  natW: number;
  natH: number;
  aspect: number;
}) {
  const colRef = React.useRef<HTMLDivElement>(null);
  const [colW, setColW] = React.useState(0);
  // True content height of the page laid out at the nominal width `natW`, measured from
  // the (same-origin) iframe after its fonts load. Null until measured → assume it fits.
  const [contentH, setContentH] = React.useState<number | null>(null);

  // A ResizeObserver tracks the column width directly, so a pane resize re-sizes this
  // cell on its own (batched per frame by the browser) without the parent having to
  // re-render every row on each drag tick.
  React.useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const measure = () => setColW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A fresh page (or a re-process that swaps the source) must re-measure.
  React.useEffect(() => setContentH(null), [reloadKey, page]);

  // Inject the author-defense CSS, wait for web-fonts (a fallback font is shorter, so
  // measuring too early under-counts text height and it later clips), then measure.
  const onLoad = React.useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.currentTarget;
    void (async () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc?.body) return;
        const style = doc.createElement("style");
        style.textContent = EPUB_PREVIEW_CSS;
        doc.head?.appendChild(style);
        // Measure only once layout is settled: web-fonts loaded (a fallback font is
        // shorter → under-measures → clips) AND images decoded (a not-yet-loaded image
        // has zero height → under-measures). The iframe `load` event isn't enough on its
        // own here because the document arrives via a redirect.
        await doc.fonts?.ready;
        await Promise.all(
          Array.from(doc.images).map((im) =>
            im.complete
              ? null
              : new Promise<void>((r) => {
                  im.addEventListener("load", () => r(), { once: true });
                  im.addEventListener("error", () => r(), { once: true });
                }),
          ),
        );
        // `fonts.ready` can resolve a tick before the font-swap reflow lands, so measure
        // after the next frames and again shortly after, taking the MAX — under-measuring
        // would clip the page, which is the one outcome we must avoid.
        // Take the tallest of body/root box and scroll heights: a last paragraph can
        // overflow the body box (body rect < real content), and the root element then
        // reports the true extent.
        const measure = () =>
          Math.max(
            doc.body.getBoundingClientRect().height,
            doc.documentElement.getBoundingClientRect().height,
            doc.body.scrollHeight,
            doc.documentElement.scrollHeight,
          );
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        let h = measure();
        await new Promise<void>((r) => setTimeout(r, 150));
        h = Math.max(h, measure());
        setContentH(h || null);
      } catch {
        /* cross-origin / detached — leave unscaled */
      }
    })();
  }, []);

  // Shrink the whole page to fit the box height when it overflows; scale that to the
  // column. A scaled (narrower) page is centered horizontally in the box.
  const fitScale = contentH && contentH > natH ? natH / contentH : 1;
  const scale = (colW > 0 ? colW / natW : 1) * fitScale;
  return (
    <div ref={colRef} style={{ width: "100%" }}>
      <div
        style={{
          width: "100%",
          aspectRatio: String(aspect),
          overflow: "hidden",
          borderRadius: 4,
          border: "1px solid var(--border)",
          background: "#fff",
          position: "relative",
        }}
      >
        {colW > 0 && (
          <iframe
            key={reloadKey}
            title={`EPUB page ${page}`}
            src={api.epubSpineUrl(runId, page)}
            onLoad={onLoad}
            scrolling="no"
            style={{
              position: "absolute",
              top: 0,
              left: Math.max(0, (colW - colW * fitScale) / 2),
              width: natW,
              height: Math.max(contentH ?? natH, natH),
              border: "none",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
});

const PairedRow = React.memo(function PairedRow({
  runId,
  pdfPage,
  bloomPage,
  sourceKind,
  aspect,
  natW,
  natH,
  reloadKey,
  view,
  bloomNotice,
}: {
  runId: string;
  // Source page rendered on the left, and the Bloom page's document index
  // rendered on the right. Either may be null (no counterpart → empty cell).
  // For an EPUB source, `pdfPage` is the 1-based spine index.
  pdfPage: number | null;
  bloomPage: number | null;
  sourceKind: "pdf" | "epub";
  aspect: number;
  natW: number;
  natH: number;
  reloadKey: number;
  view: ViewMode;
  // Placeholder shown in the Bloom column when there's no Bloom page (book not
  // styled yet / run failed). Only the first row receives it; null otherwise.
  bloomNotice?: React.ReactNode;
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
    // view.mode is a dep because the measured element (half-width column vs.
    // full-width overlay/single box) changes when toggling, so colW must
    // re-observe. A pane resize is handled by the observer itself (no paneWidth
    // dep needed), so dragging the resizer doesn't re-run this effect per row.
  }, [view.mode]);

  // Re-measure on reload (Bloom re-process swaps styled HTML in at the same URL).
  React.useEffect(() => setMeasured(null), [reloadKey]);

  const measureBloomPage = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument;
      const win = e.currentTarget.contentWindow;
      if (!doc || !win) return;
      const pages = Array.from(doc.querySelectorAll<HTMLElement>("body > .bloom-page"));
      const visible = pages.find((p) => win.getComputedStyle(p).display !== "none") ?? pages[0];
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
  // to stack, so it falls back to showing whichever side it has.
  const overlay = view.mode === "super" && pdfPage !== null && bloomPage !== null;

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
    // Single / side-by-side: a plain, faithful block image of the source page.
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
  } else if (pdfPage !== null) {
    // Superimposed: tint the PDF blue, then fade the whole layer over Bloom. The blue
    // "screen" overlay sits on the PDF only — `isolation: isolate` keeps the blend
    // from reaching the Bloom iframe behind. opacity drives the fade.
    pdfImg = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: view.opacity,
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
        // Stacked: Bloom underneath, source blended/faded on top, in one box.
        <div ref={colRef} style={{ width: "100%" }}>
          <div style={boxStyle}>
            {bloomIframe}
            {pdfImg}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div ref={colRef} style={colStyle}>
            {/* EPUB: the faithful spine page (illustration + prose, in the EPUB's own
                layout). PDF: a flat page render. */}
            {sourceKind === "epub" && pdfPage !== null ? (
              <EpubPageCell
                runId={runId}
                page={pdfPage}
                reloadKey={reloadKey}
                natW={natW}
                natH={natH}
                aspect={aspect}
              />
            ) : (
              pdfImg
            )}
          </div>
          <div style={colStyle}>
            {/* The real Bloom page once styled; otherwise the placeholder notice
                (first row only) explaining why there's nothing to show yet. */}
            {bloomPage !== null ? <div style={boxStyle}>{bloomIframe}</div> : bloomNotice}
          </div>
        </div>
      )}
    </div>
  );
});
