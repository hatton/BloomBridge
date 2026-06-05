/* Modals, drawers, run-config, stepper, compare, settings, confirm (ported from modals.jsx) */
import React from "react";
import { Icon } from "../lib/icons";
import { BLOOM } from "../data/mockData";
import { Btn, IconBtn, Field, Select, Thumb, StatusPill, effStatus, fmt } from "./primitives";
import { SectionLabel, ParamControls } from "./panels";
import { api } from "../api";
import type { Params, Run, Settings, Source, Stage } from "../types";

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
  const base = run ? run.params : BLOOM.DEFAULT_PARAMS;
  const [p, setP] = React.useState<Params>({ ...base });
  const [start, setStart] = React.useState<Stage>("ocr");
  const set = (k: keyof Params, v: any) => setP((o) => ({ ...o, [k]: v }));

  // which stages are cached/available for resume
  const cached = run ? run.stages : { ocr: false, llm: false, plan: false, html: false };
  const stageEnabled = (s: Stage) => {
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
            {run ? "Re-run" : "Run conversion"}
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
          ? `${BLOOM.STAGE_LABELS[s]} can't be a start point — its input (${BLOOM.STAGE_LABELS[BLOOM.STAGES[i - 1]]} output) doesn't exist for this run yet.`
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
    "pdf2bloom " +
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
    (p.complexBecomesImage !== "off"
      ? " \\\n  --complex-becomes-image " + p.complexBecomesImage
      : "") +
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
  collections = [],
  onChange,
  onClose,
}: {
  settings: Settings;
  collections?: { path: string; name: string }[];
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const s = settings;
  const upd = (k: keyof Settings, v: any) => onChange({ ...s, [k]: v });
  return (
    <Overlay onClose={onClose}>
      <ModalCard
        width={560}
        title="Settings"
        subtitle="Stored locally on this machine"
        icon="settings"
        onClose={onClose}
      >
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          <SectionLabel>API keys</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {(
              [
                ["openrouterKey", "OpenRouter API key", "sk-or-…"],
                ["mistralKey", "Mistral API key (only for --ocr mistral)", "…"],
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

          <SectionLabel>Defaults</SectionLabel>
          <div style={{ marginBottom: 12 }}>
            <Field label="Workspace folder (where runs are stored)">
              <input
                value={s.workspace}
                onChange={(e) => upd("workspace", e.target.value)}
                placeholder="…/.pdf2bloom/workspace"
                className="mono"
                style={{
                  width: "100%",
                  height: 32,
                  padding: "0 10px",
                  fontSize: 12,
                  color: "var(--text)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  outline: "none",
                }}
              />
            </Field>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}
          >
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
  danger,
  onConfirm,
  onClose,
}: {
  title?: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
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
