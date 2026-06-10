/* Modals, drawers, run-config, stepper, compare, settings, confirm (ported from modals.jsx) */
import React from "react";
import { Icon } from "../lib/icons";
import { BLOOM } from "../data/mockData";
import {
  Btn,
  IconBtn,
  Field,
  Select,
  Thumb,
  StatusPill,
  MarkControl,
  PinButton,
  effStatus,
  fmt,
} from "./primitives";
import {
  SectionLabel,
  ParamControls,
  LogTab,
  DetailsTab,
  MetricsTab,
  ArtifactsTab,
  NotesTab,
  ErrorBanner,
  CopyRunButton,
} from "./panels";
import { api } from "../api";
import type { Mark, Params, Run, Settings, Source, Stage } from "../types";

// ---------- shells ----------
export function Overlay({
  children,
  onClose,
  align = "center",
}: {
  children: React.ReactNode;
  onClose: () => void;
  align?: "center" | "right";
}) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "oklch(0.2 0.02 260 / 0.42)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: align === "center" ? "center" : "stretch",
        justifyContent: align === "right" ? "flex-end" : "center",
        padding: align === "center" ? 24 : 0,
      }}
    >
      {children}
    </div>
  );
}

export function ModalCard({
  children,
  width = 560,
  onClose,
  title,
  subtitle,
  icon,
}: {
  children?: React.ReactNode;
  width?: number;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
}) {
  return (
    <div
      className="scale-in"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        width,
        maxWidth: "100%",
        maxHeight: "92vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <ModalHeader {...{ title, subtitle, icon, onClose }} />
      {children}
    </div>
  );
}

function Drawer({
  children,
  width = 460,
  onClose,
  title,
  subtitle,
  icon,
}: {
  children?: React.ReactNode;
  width?: number;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: string;
}) {
  return (
    <div
      className="drawer-in"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        width,
        maxWidth: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        boxShadow: "var(--shadow-lg)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      <ModalHeader {...{ title, subtitle, icon, onClose }} />
      {children}
    </div>
  );
}

function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  icon?: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      {icon && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent)",
          }}
        >
          <Icon name={icon} size={16} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>{subtitle}</div>
        )}
      </div>
      <IconBtn name="x" onClick={onClose} title="Close" iconSize={17} />
    </div>
  );
}

// ============ MASTER-PAGE PICKER ============

/** A scaled thumbnail of one master-book page, rendered in an iframe and measured
 *  so the whole page fits the tile (mirrors the paired-preview Bloom page scaling). */
function MasterThumb({ runId, index }: { runId: string; index: number }) {
  const colRef = React.useRef<HTMLDivElement>(null);
  const [colW, setColW] = React.useState(0);
  const [m, setM] = React.useState<{ w: number; h: number; left: number; top: number } | null>(
    null,
  );
  React.useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const measure = () => setColW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = e.currentTarget.contentDocument;
      const win = e.currentTarget.contentWindow;
      if (!doc || !win) return;
      const pages = Array.from(doc.querySelectorAll<HTMLElement>("body > .bloom-page"));
      const visible = pages.find((p) => win.getComputedStyle(p).display !== "none") ?? pages[0];
      if (!visible) return;
      const r = visible.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setM({ w: r.width, h: r.height, left: r.left, top: r.top });
    } catch {
      /* not ready / unreadable */
    }
  };
  return (
    <div
      ref={colRef}
      style={{
        width: "100%",
        aspectRatio: String(m ? m.w / m.h : 0.707),
        overflow: "hidden",
        borderRadius: 4,
        border: "1px solid var(--border)",
        background: "#fff",
        position: "relative",
      }}
    >
      {colW > 0 && (
        <iframe
          title={`Master page ${index}`}
          src={api.masterPageUrl(runId, index)}
          scrolling="no"
          onLoad={onLoad}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: m ? m.left + m.w : 400,
            height: m ? m.top + m.h : 560,
            border: "none",
            transform: m
              ? `scale(${colW / m.w}) translate(${-m.left}px, ${-m.top}px)`
              : `scale(${colW / 400})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

/** Pick which master-book page should serve a given source page (or clear the
 *  mapping). The choice is persisted at the collection level and re-applied
 *  immediately to the current book's preview. */
export function MasterPagePickerModal({
  runId,
  sourceHash,
  onClose,
  onChoose,
}: {
  runId: string;
  sourceHash: string;
  onClose: () => void;
  onChoose: (masterPageId: string | null) => void;
}) {
  const [state, setState] = React.useState<{
    ready: boolean;
    pages: { id: string; index: number }[];
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api
      .masterPages(runId)
      .then((r) => {
        if (alive) setState({ ready: r.ready, pages: r.pages || [] });
      })
      .catch(() => {
        if (alive) setState({ ready: false, pages: [] });
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  const choose = (id: string | null) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(onChoose(id)).finally(() => setBusy(false));
  };

  const tileBtn: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    cursor: busy ? "wait" : "pointer",
    textAlign: "center",
    font: "inherit",
    color: "var(--text)",
  };

  return (
    <Overlay onClose={onClose}>
      <ModalCard
        width={760}
        onClose={onClose}
        icon="image"
        title="Use a master book page"
        subtitle={`Pick the master page to substitute for this source page (hash ${sourceHash.slice(0, 8)}). The choice is saved for this and future imports.`}
      >
        <div style={{ padding: 16, overflowY: "auto" }}>
          {!state ? (
            <div
              style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}
            >
              Loading master pages…
            </div>
          ) : !state.ready ? (
            <div
              style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}
            >
              No master book found in this collection. Add a sibling book folder whose name ends in
              “master”, then try again.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 12,
              }}
            >
              <button type="button" disabled={busy} onClick={() => choose(null)} style={tileBtn}>
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "0.707",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 4,
                    border: "1px dashed var(--border)",
                    color: "var(--text-3)",
                    fontSize: 22,
                  }}
                >
                  ∅
                </div>
                <span style={{ fontSize: 11, fontWeight: 600 }}>Use none / clear</span>
              </button>
              {state.pages.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  disabled={busy}
                  onClick={() => choose(p.id)}
                  style={tileBtn}
                >
                  <MasterThumb runId={runId} index={p.index} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Page {p.index}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </ModalCard>
    </Overlay>
  );
}

// ============ RUN CONFIG ============
export function RunConfig({
  source,
  run,
  mode,
  parallelism,
  defaults,
  onClose,
  onConfirm,
}: {
  source: Source;
  run?: Run | null;
  mode: string;
  parallelism: number;
  defaults?: Params;
  onClose: () => void;
  onConfirm: (v: { params: Params; start: Stage }) => void;
}) {
  // When cloning/resuming a prior run, start from its params but backfill any options
  // that run predates (e.g. trimWhitespace / fitImagePanes) from the defaults — so a
  // newer option isn't shown as off / "changed" just because the old run never stored it.
  const base = run
    ? { ...(defaults || BLOOM.DEFAULT_PARAMS), ...run.params }
    : BLOOM.DEFAULT_PARAMS;
  const [p, setP] = React.useState<Params>({ ...base });
  const [start, setStart] = React.useState<Stage>("ocr");
  const set = (k: keyof Params, v: any) => setP((o) => ({ ...o, [k]: v }));

  // which stages are cached/available for resume
  const cached = run
    ? run.stages
    : { ocr: false, llm: false, plan: false, html: false, bloom: false };
  const stageEnabled = (s: Stage) => {
    // "bloom" always runs after HTML as the final stage — it's a post-process, not a
    // resumable artifact, so it can never be a start point.
    if (s === "bloom") return false;
    if (!run) return s === "ocr"; // fresh run starts at ocr
    const idx = BLOOM.STAGES.indexOf(s);
    if (idx === 0) return true;
    return BLOOM.STAGES.slice(0, idx).every((ps) => cached[ps]);
  };

  const Body = (
    <React.Fragment>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        {/* book context */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "10px 12px",
            background: "var(--surface-2)",
            borderRadius: "var(--radius)",
            marginBottom: 16,
          }}
        >
          <Thumb hue={source.hue} w={32} h={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{source.name}</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              {source.file}
              {source.pages ? ` · ${source.pages}p` : ""}
            </div>
          </div>
          {run && (
            <span
              style={{
                fontSize: 10.5,
                color: "var(--text-3)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Icon name="refresh" size={12} />
              re-run of {run.id}
            </span>
          )}
        </div>

        {/* resume stepper */}
        <SectionLabel>Resume from stage</SectionLabel>
        <Stepper
          start={start}
          onStart={setStart}
          stageEnabled={stageEnabled}
          cached={cached}
          hasRun={!!run}
        />
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: 11,
            color: "var(--text-2)",
            margin: "8px 0 18px",
            padding: "7px 9px",
            background: "var(--accent-soft)",
            borderRadius: 5,
          }}
        >
          <Icon name="info" size={13} style={{ color: "var(--accent)", marginTop: 1 }} />
          <span>
            {start === "ocr"
              ? "Runs the full pipeline from scratch."
              : `Reuses cached output through ${BLOOM.STAGE_LABELS[BLOOM.STAGES[BLOOM.STAGES.indexOf(start) - 1]]} — faster and cheaper.`}
          </span>
        </div>

        {/* raw settings */}
        <SectionLabel>Conversion settings</SectionLabel>
        <ParamControls params={p} onChange={set} defaults={defaults} />

        {/* command summary */}
        <SectionLabel>Command summary</SectionLabel>
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 10.5,
            lineHeight: 1.6,
            color: "var(--text-2)",
            background: "var(--surface-3)",
            borderRadius: "var(--radius-sm)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            position: "relative",
          }}
        >
          {previewCmd(source, p, start)}
          <span style={{ position: "absolute", top: 7, right: 7 }}>
            <IconBtn name="copy" size={24} iconSize={13} title="Copy" />
          </span>
        </pre>
      </div>

      {/* footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon name="info" size={13} />
          Queues if &gt; {parallelism} active
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn variant="default" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" icon="play" onClick={() => onConfirm({ params: p, start })}>
            {run ? "Re-run" : "Convert to Bloom"}
          </Btn>
        </div>
      </div>
    </React.Fragment>
  );

  const headerProps = {
    title: run ? "Re-run conversion" : "New conversion",
    subtitle: source.name,
    icon: "sliders",
    onClose,
  };
  return mode === "drawer" ? (
    <Overlay onClose={onClose} align="right">
      <Drawer width={460} {...headerProps}>
        {Body}
      </Drawer>
    </Overlay>
  ) : (
    <Overlay onClose={onClose}>
      <ModalCard width={580} {...headerProps}>
        {Body}
      </ModalCard>
    </Overlay>
  );
}

// ---------- Stepper ----------
function Stepper({
  start,
  onStart,
  stageEnabled,
  cached,
  hasRun,
}: {
  start: Stage;
  onStart: (s: Stage) => void;
  stageEnabled: (s: Stage) => boolean;
  cached: Record<string, boolean>;
  hasRun: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
      {BLOOM.STAGES.map((s, i) => {
        const enabled = stageEnabled(s);
        const isStart = start === s;
        const isCached =
          hasRun && cached[s] && BLOOM.STAGES.indexOf(s) < BLOOM.STAGES.indexOf(start);
        const willRun = BLOOM.STAGES.indexOf(s) >= BLOOM.STAGES.indexOf(start);
        const tip = !enabled
          ? s === "bloom"
            ? "Bloom always runs after HTML as the final stage — it can't be a start point."
            : `${BLOOM.STAGE_LABELS[s]} can't be a start point — its input (${BLOOM.STAGE_LABELS[BLOOM.STAGES[i - 1]]} output) doesn't exist for this run yet.`
          : isStart
            ? "Start here"
            : willRun
              ? "Will run"
              : "Cached — reused";
        return (
          <React.Fragment key={s}>
            <button
              title={tip}
              disabled={!enabled}
              onClick={() => enabled && onStart(s)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                padding: "10px 4px",
                border: "1.5px solid " + (isStart ? "var(--accent)" : "transparent"),
                borderRadius: "var(--radius)",
                cursor: enabled ? "pointer" : "not-allowed",
                background: isStart ? "var(--accent-soft)" : "transparent",
                opacity: enabled ? 1 : 0.4,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  background: isStart
                    ? "var(--accent)"
                    : isCached
                      ? "var(--st-done-bg)"
                      : "var(--surface-3)",
                  color: isStart
                    ? "var(--accent-fg)"
                    : isCached
                      ? "var(--st-done-fg)"
                      : "var(--text-3)",
                }}
              >
                {isCached ? <Icon name="check" size={13} strokeWidth={2.4} /> : i + 1}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isStart ? "var(--accent)" : "var(--text-2)",
                }}
              >
                {BLOOM.STAGE_LABELS[s]}
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 600,
                  letterSpacing: ".3px",
                  textTransform: "uppercase",
                  color: isStart
                    ? "var(--accent)"
                    : isCached
                      ? "var(--st-done-fg)"
                      : "var(--text-3)",
                }}
              >
                {isStart ? "start" : isCached ? "cached" : willRun ? "run" : "—"}
              </span>
            </button>
            {i < BLOOM.STAGES.length - 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "var(--text-3)",
                  padding: "0 1px",
                  opacity: 0.6,
                }}
              >
                <Icon name="chevron" size={13} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function previewCmd(source: Source, p: Params, start: Stage) {
  // Resuming from a later stage = feeding the matching intermediate artifact as
  // input (the CLI infers the start stage from the input file's extension).
  const base = source.file.replace(/\.pdf$/i, "");
  const input =
    start === "ocr"
      ? source.file
      : base + (start === "llm" ? ".ocr.md" : start === "plan" ? ".llm.md" : ".bloom.md");
  return (
    "bloombridge " +
    input +
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
    (p.trimWhitespace ? " \\\n  --trim-whitespace" : "") +
    (p.fitImagePanes === false ? " \\\n  --no-fit-image-panes" : "") +
    " \\\n  --target " +
    p.target
  );
}

// ============ COMPARE ============
export function CompareModal({
  source,
  initialA,
  onClose,
}: {
  source: Source;
  initialA?: string | null;
  onClose: () => void;
}) {
  const done = source.runs;
  const [a, setA] = React.useState<string | undefined>(initialA || done[0]?.id);
  const [b, setB] = React.useState<string | undefined>(
    done.find((r) => r.id !== a)?.id || done[1]?.id,
  );
  const ra = done.find((r) => r.id === a),
    rb = done.find((r) => r.id === b);
  const fields: [string, (r: Run) => React.ReactNode][] = [
    ["Model", (r) => BLOOM.MODELS[r.params.model]?.label],
    ["OCR method", (r) => BLOOM.ocrMethods[r.params.ocrMethod]],
    ["Vision formatting", (r) => (r.params.visionFormatting ? "On" : "Off")],
    [
      "Vision model",
      (r) => (r.params.visionFormatting ? BLOOM.MODELS[r.params.visionModel]?.label || "—" : "—"),
    ],
    ["Cover handling", (r) => BLOOM.coverModes[r.params.coverMode]],
    ["Flatten complex", (r) => BLOOM.complexLevels[r.params.complexBecomesImage]],
    ["Trim whitespace", (r) => (r.params.trimWhitespace ? "On" : "Off")],
    ["Fit image panes", (r) => (r.params.fitImagePanes ? "On" : "Off")],
    ["Target", (r) => BLOOM.targets[r.params.target]],
  ];
  const outcomes: [string, (r: Run) => React.ReactNode][] = [
    ["Status", (r) => <StatusPill status={effStatus(r)} size="sm" />],
    ["Cost", (r) => fmt.cost(r.cost)],
    ["Time", (r) => fmt.time(r.time)],
    ["Tokens i/o", (r) => fmt.tokens(r.tokensIn) + " / " + fmt.tokens(r.tokensOut)],
  ];
  const runOpts = done.map((r) => ({
    value: r.id,
    label: r.id + " · " + (BLOOM.MODELS[r.model]?.label || "") + " · " + fmt.cost(r.cost),
  }));

  return (
    <Overlay onClose={onClose}>
      <ModalCard
        width={620}
        title="Compare runs"
        subtitle={source.name}
        icon="diff"
        onClose={onClose}
      >
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr 1fr",
              gap: 10,
              marginBottom: 14,
              alignItems: "center",
            }}
          >
            <span></span>
            <Select full value={a || ""} onChange={setA} options={runOpts} />
            <Select full value={b || ""} onChange={setB} options={runOpts} />
          </div>
          {ra && rb && (
            <React.Fragment>
              <CompareSection title="Outcomes" rows={outcomes} ra={ra} rb={rb} />
              <CompareSection title="Parameters" rows={fields} ra={ra} rb={rb} diff />
            </React.Fragment>
          )}
        </div>
      </ModalCard>
    </Overlay>
  );
}

function CompareSection({
  title,
  rows,
  ra,
  rb,
  diff,
}: {
  title: string;
  rows: [string, (r: Run) => React.ReactNode][];
  ra: Run;
  rb: Run;
  diff?: boolean;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel>{title}</SectionLabel>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {rows.map(([label, fn], i) => {
          const va = fn(ra),
            vb = fn(rb);
          const isDiff = diff && JSON.stringify(va) !== JSON.stringify(vb);
          return (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 1fr",
                gap: 10,
                padding: "8px 12px",
                fontSize: 12,
                alignItems: "center",
                borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                background: isDiff
                  ? "var(--st-run-bg)"
                  : i % 2
                    ? "var(--surface-2)"
                    : "transparent",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {isDiff && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: "var(--st-run-fg)",
                    }}
                  />
                )}
                {label}
              </span>
              <span style={{ fontWeight: isDiff ? 700 : 500, color: "var(--text)" }}>{va}</span>
              <span style={{ fontWeight: isDiff ? 700 : 500, color: "var(--text)" }}>{vb}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ SETTINGS ============
export function SettingsModal({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  // Always present for the App's call; the collection control is commented out for now.
  collections?: { path: string; name: string }[];
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const s = settings;
  const upd = (k: keyof Settings, v: any) => onChange({ ...s, [k]: v });
  return (
    <Overlay onClose={onClose}>
      <ModalCard width={560} title="Settings" icon="settings" onClose={onClose}>
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          <SectionLabel>API keys</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {(
              [
                [
                  "openrouterKey",
                  "OpenRouter API key to pay for AI's doing PDF imports",
                  "sk-or-…",
                ],
              ] as [keyof Settings, string, string][]
            ).map(([k, label, ph]) => (
              <Field key={k} label={label}>
                <div style={{ position: "relative" }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 9,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--text-3)",
                    }}
                  >
                    <Icon name="key" size={13} />
                  </span>
                  <input
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    value={(s[k] as string) || ""}
                    onChange={(e) => upd(k, e.target.value)}
                    placeholder={ph}
                    className="mono"
                    style={{
                      width: "100%",
                      height: 32,
                      padding: "0 70px 0 30px",
                      fontSize: 12,
                      color: "var(--text)",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    title="Paste from clipboard"
                    onClick={async () => {
                      try {
                        const text = (await navigator.clipboard.readText()).trim();
                        if (text) upd(k, text);
                      } catch {
                        /* clipboard unavailable / denied */
                      }
                    }}
                    style={{
                      position: "absolute",
                      right: 5,
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      height: 24,
                      padding: "0 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-2)",
                      background: "var(--surface-3)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    <Icon name="copy" size={11} /> Paste
                  </button>
                </div>
              </Field>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <Field label="Workspace folder (where runs are stored)">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await api.pickFolder(s.workspace || undefined);
                      if (r.path) upd("workspace", r.path);
                    } catch {
                      /* picker cancelled / unavailable */
                    }
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 32,
                    padding: "0 11px",
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-2)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                  }}
                >
                  <Icon name="folder" size={13} />
                  Choose…
                </button>
                <span
                  className="mono"
                  title={s.workspace}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 10px",
                    fontSize: 12,
                    color: s.workspace ? "var(--text)" : "var(--text-3)",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.workspace || "No folder chosen"}
                </span>
                <IconBtn
                  name="folder-open"
                  title="Open this folder in File Explorer"
                  disabled={!s.workspace}
                  onClick={() => s.workspace && api.osOpen(s.workspace, "folder")}
                />
              </div>
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            {/* Default Bloom collection control commented out — we always use the
                running Bloom's open collection for now.
            <Field label="Default Bloom collection (hints + keeper)">
              <Select
                full
                value={s.collection}
                onChange={(v) => upd("collection", v)}
                options={[
                  { value: "__running__", label: "The collection in the running Bloom" },
                  ...collections.map((c) => ({ value: c.path, label: c.name })),
                  { value: "", label: "— none —" },
                ]}
              />
            </Field>
            */}
            <Field label="Max parallel conversions" hint={s.parallelism + ""}>
              <input
                type="range"
                min="1"
                max="6"
                value={s.parallelism}
                onChange={(e) => upd("parallelism", +e.target.value)}
                style={{ width: "100%", accentColor: "var(--accent)", marginTop: 8 }}
              />
            </Field>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <Btn variant="primary" icon="check" onClick={onClose}>
            Save settings
          </Btn>
        </div>
      </ModalCard>
    </Overlay>
  );
}

// ============ PREVIEW (copy the run's book into the Bloom collection) ============
export function PreviewModal({
  run,
  source,
  onClose,
}: {
  run: Run;
  source: Source;
  bloomRunning?: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = React.useState<"idle" | "working" | "done" | "error">("idle");
  const [dest, setDest] = React.useState<string>("");
  const [msg, setMsg] = React.useState<string>("");

  const copyIntoCollection = async () => {
    setPhase("working");
    try {
      const r = await api.preview(run.id);
      setDest(r.dest || "");
      setPhase("done");
    } catch (e: any) {
      setMsg(e?.message || String(e));
      setPhase("error");
    }
  };

  return (
    <Overlay onClose={onClose}>
      <ModalCard
        width={460}
        title="Preview in Bloom"
        subtitle={source.name + " · " + run.id}
        icon="eye"
        onClose={onClose}
      >
        <div style={{ padding: "18px" }}>
          <p
            style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, margin: "0 0 14px" }}
          >
            This copies the converted book into your Bloom collection (as
            <span className="mono"> preview - {source.name}</span>) so you can open it in Bloom.
          </p>

          {phase === "done" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                padding: "9px 11px",
                borderRadius: "var(--radius)",
                background: "var(--st-done-bg)",
                color: "var(--st-done-fg)",
                fontSize: 11.5,
                marginBottom: 14,
              }}
            >
              <Icon name="check" size={14} style={{ marginTop: 1 }} />
              <span>
                Copied into your collection. Switch to <b>Bloom</b> and reload the collection to
                view it.
                <br />
                <span
                  className="mono"
                  style={{ fontSize: 10.5, opacity: 0.85, wordBreak: "break-all" }}
                >
                  {dest}
                </span>
              </span>
            </div>
          )}
          {phase === "error" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                padding: "9px 11px",
                borderRadius: "var(--radius)",
                background: "var(--st-fail-bg)",
                color: "var(--st-fail-fg)",
                fontSize: 11.5,
                marginBottom: 14,
              }}
            >
              <Icon name="alert" size={14} style={{ marginTop: 1 }} />
              <span>{msg}</span>
            </div>
          )}
          {phase !== "done" && phase !== "error" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                padding: "9px 11px",
                borderRadius: "var(--radius)",
                background: "var(--surface-2)",
                color: "var(--text-2)",
                fontSize: 11,
                marginBottom: 14,
              }}
            >
              <Icon name="info" size={14} style={{ marginTop: 1, color: "var(--accent)" }} />
              <span>
                Auto-focusing Bloom isn't wired up yet — you'll switch to Bloom yourself and reload
                the collection.
              </span>
            </div>
          )}

          {phase === "done" ? (
            <Btn variant="default" full icon="check" onClick={onClose}>
              Done
            </Btn>
          ) : (
            <Btn
              variant="primary"
              full
              icon="download"
              disabled={phase === "working"}
              onClick={copyIntoCollection}
            >
              {phase === "working" ? "Copying…" : "Copy into Bloom collection"}
            </Btn>
          )}
        </div>
      </ModalCard>
    </Overlay>
  );
}

// ============ CONFIRM ============
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  secondaryLabel,
  danger,
  onConfirm,
  onSecondary,
  onClose,
}: {
  title?: string;
  message?: string;
  confirmLabel?: string;
  /** Optional middle button (e.g. an alternative action alongside Cancel + confirm). */
  secondaryLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onSecondary?: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <ModalCard width={400} title={title} icon={danger ? "alert" : "info"} onClose={onClose}>
        <div style={{ padding: "4px 18px 18px" }}>
          <p
            style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, margin: "8px 0 18px" }}
          >
            {message}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="default" onClick={onClose}>
              Cancel
            </Btn>
            {secondaryLabel && onSecondary && (
              <Btn variant="default" onClick={onSecondary}>
                {secondaryLabel}
              </Btn>
            )}
            <Btn
              variant={danger ? "danger" : "primary"}
              icon={danger ? "trash" : "check"}
              onClick={onConfirm}
            >
              {confirmLabel || "Confirm"}
            </Btn>
          </div>
        </div>
      </ModalCard>
    </Overlay>
  );
}

// ============ CONVERSION SETTINGS ============
// The conversion settings (formerly the body of the right-hand Details pane),
// now reached via the gear button beside "Run conversion" in the preview pane.
export function ConvSettingsModal({
  source,
  params,
  defaults,
  onChange,
  onRun,
  onClose,
}: {
  source?: Source | null;
  params: Params;
  defaults?: Params;
  onChange: (k: keyof Params, v: any) => void;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <ModalCard
        width={560}
        title="Conversion settings"
        subtitle={source?.name}
        icon="sliders"
        onClose={onClose}
      >
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          <ParamControls params={params} onChange={onChange} defaults={defaults} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <Btn variant="default" onClick={onClose}>
            Done
          </Btn>
          <Btn
            variant="primary"
            icon="play"
            onClick={() => {
              onRun();
              onClose();
            }}
          >
            Convert to Bloom
          </Btn>
        </div>
      </ModalCard>
    </Overlay>
  );
}

// ============ RUN DETAILS ============
// Everything that used to live in the right-hand run Details pane — the live log,
// artifacts browser, metrics, notes, plus mark/pin/re-run/resume/delete actions —
// now opened on demand as a modal from a row's details button or the preview pane.
export function RunDetailsModal({
  run,
  source,
  onClose,
  onMark,
  onPin,
  onNotes,
  onCancel,
  onConfigRerun,
  onResume,
  onDelete,
  onCompare,
}: {
  run: Run;
  source: Source;
  onClose: () => void;
  onMark: (sid: string, rid: string, v: Mark) => void;
  onPin: (sid: string, rid: string, v: boolean) => void;
  onNotes: (sid: string, rid: string, patch: Partial<Run>) => void;
  onCancel: (sid: string, rid: string) => void;
  onConfigRerun: (s: Source, r: Run) => void;
  onResume: (s: Source, r: Run) => void;
  onDelete: (sid: string, rid: string) => void;
  onCompare?: (s: Source) => void;
}) {
  const [tab, setTab] = React.useState("artifacts");
  const eff = effStatus(run);
  return (
    <Overlay onClose={onClose}>
      <ModalCard width={640} title={source.name} subtitle={run.id} icon="layers" onClose={onClose}>
        {/* Fixed height (not max-height) so the dialog stays the same size as you
            switch tabs — the content area below fills the remainder and scrolls. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            height: "min(82vh, 680px)",
          }}
        >
          {/* sub-header: status + curation + actions */}
          <div style={{ padding: "12px 16px 11px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
              {/* The disapproval is already conveyed by MarkControl, so skip the
                  redundant "Disapproved" pill. */}
              {eff !== "disapproved" && <StatusPill status={eff} />}
              {run.status === "done" && (
                <MarkControl mark={run.mark} onChange={(v) => onMark(source.id, run.id, v)} />
              )}
              <PinButton pinned={!!run.pinned} onChange={(v) => onPin(source.id, run.id, v)} />
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {onCompare && source.runs.length > 1 && (
                  <IconBtn name="diff" title="Compare runs" onClick={() => onCompare(source)} />
                )}
                <CopyRunButton source={source} run={run} />
                <IconBtn
                  name="trash"
                  title="Delete run"
                  danger
                  onClick={() => onDelete(source.id, run.id)}
                />
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {run.status === "running" || run.status === "queued" ? (
                <Btn
                  variant="danger"
                  size="sm"
                  icon="stop"
                  onClick={() => onCancel(source.id, run.id)}
                  style={{ flex: 1 }}
                >
                  Cancel run
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  size="sm"
                  icon="refresh"
                  onClick={() => onConfigRerun(source, run)}
                  style={{ flex: 1 }}
                >
                  Re-run with new settings
                </Btn>
              )}
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
                    : "Start over from the source (no earlier stage completed)"
                }
              >
                Run from last successful stage
              </Btn>
            )}
          </div>

          {run.status === "failed" && run.error && <ErrorBanner error={run.error} />}

          {/* tabs */}
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: "8px 12px 0",
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

          <div
            style={{
              flex: 1,
              minHeight: 260,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {tab === "log" && <LogTab run={run} />}
            {tab === "details" && <DetailsTab run={run} source={source} />}
            {tab === "metrics" && <MetricsTab run={run} />}
            {tab === "artifacts" && <ArtifactsTab run={run} />}
            {tab === "notes" && <NotesTab run={run} source={source} onNotes={onNotes} />}
          </div>
        </div>
      </ModalCard>
    </Overlay>
  );
}
