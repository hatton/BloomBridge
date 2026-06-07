/* Shared UI primitives + formatters (ported from components.jsx) */
import React from "react";
import { Icon } from "../lib/icons";
import { BLOOM } from "../data/mockData";
import type { EffStatus, Mark, Run } from "../types";

// ---------- formatters ----------
export const fmt = {
  tokens(n?: number) {
    if (!n) return "—";
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "" + n;
  },
  cost(n?: number | null) {
    if (n == null) return "—";
    if (n === 0) return "$0.00";
    return n < 0.01 ? "$" + n.toFixed(4) : "$" + n.toFixed(n < 1 ? 3 : 2);
  },
  time(s?: number) {
    if (!s) return "—";
    const m = Math.floor(s / 60),
      r = Math.round(s % 60);
    return m ? m + "m " + String(r).padStart(2, "0") + "s" : r + "s";
  },
  timeClock(s?: number) {
    if (!s) return "0:00";
    const m = Math.floor(s / 60),
      r = Math.round(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  },
  // Elapsed wall-clock: bare seconds under a minute, then m:ss.
  elapsed(s?: number) {
    if (s == null) return "";
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60),
      r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  },
  date(ts?: string) {
    return ts ? ts.replace(/^2026-/, "").replace(/-/, "/") : "—";
  },
};

// Live-ticking elapsed time. Counts up every second while running; freezes at
// (finishedAt - startedAt) once the run ends.
export function ElapsedTimer({
  startedAt,
  finishedAt,
  style,
}: {
  startedAt?: number;
  finishedAt?: number;
  style?: React.CSSProperties;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (finishedAt || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, finishedAt]);
  if (!startedAt) return null;
  const end = finishedAt || now;
  const s = Math.max(0, Math.floor((end - startedAt) / 1000));
  return (
    <span className="mono" style={style}>
      {fmt.elapsed(s)}
    </span>
  );
}

export const STATUS_META: Record<string, { label: string; st: string; icon?: string }> = {
  notrun: { label: "Not run", st: "idle" },
  queued: { label: "Queued", st: "queued" },
  running: { label: "Running", st: "run" },
  failed: { label: "Failed", st: "fail", icon: "alert" },
  completed: { label: "Awaiting Review", st: "keeper", icon: "clock" },
  reviewed: { label: "Reviewed", st: "done", icon: "check" },
  keeper: { label: "Approved", st: "done", icon: "thumbsUp" },
  disapproved: { label: "Disapproved", st: "disapprove", icon: "thumbsDown" },
  done: { label: "Awaiting Review", st: "keeper", icon: "clock" }, // alias fallback
};

/** True once every Conversion Review Checklist item has been worked through
 *  (each item is thumbed up or down). */
export function checklistComplete(run?: Run | null): boolean {
  const marks = run?.checklist || {};
  return BLOOM.CHECKLIST_ITEMS.every((it) => marks[it.key] === "up" || marks[it.key] === "down");
}

// Unified run status: rating folds into status once a run is completed
export function effStatus(run?: Run | null): EffStatus {
  if (!run) return "notrun";
  if (run.status !== "done") return run.status as EffStatus; // notrun | queued | running | failed
  if (run.mark === "good") return "keeper";
  if (run.mark === "bad") return "disapproved";
  // An unrated completed run is "Awaiting Review" until the checklist is worked
  // through; once it is, it reads as "Reviewed" rather than awaiting.
  return checklistComplete(run) ? "reviewed" : "completed";
}

// ---------- Metadata-review checklist status ----------
/** The checklist items a user has thumbed down, by label. There is no overall
 *  up/down verdict — only the individual items that were flagged as problems. */
export function checklistDownLabels(run?: Run | null): string[] {
  const marks = run?.checklist || {};
  return BLOOM.CHECKLIST_ITEMS.filter((it) => marks[it.key] === "down").map((it) => it.label);
}

/** Compact Status-column indicator: a thumbs-down + the list of checklist items the
 *  user flagged as problems. Nothing is shown when there are no flagged items —
 *  there is no "all good" or "review pending" overall state. */
export function ChecklistStatus({ run }: { run?: Run | null }) {
  const downLabels = checklistDownLabels(run);
  if (!downLabels.length) return null;
  return (
    <span
      title={"Checklist issues: " + downLabels.join(", ")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--bad)",
        fontSize: 10.5,
        fontWeight: 600,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <Icon name="thumbsDown" size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {downLabels.join(", ")}
      </span>
    </span>
  );
}

// ---------- Status pill ----------
export function StatusPill({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const m = STATUS_META[status] || STATUS_META.notrun;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: sm ? "1px 8px 1px 6px" : "2px 10px 2px 7px",
        fontSize: sm ? 10.5 : 11.5,
        fontWeight: 600,
        lineHeight: 1.6,
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: `var(--st-${m.st}-bg)`,
        color: `var(--st-${m.st}-fg)`,
      }}
    >
      {status !== "running" && m.icon ? (
        <Icon name={m.icon} size={sm ? 11 : 12} strokeWidth={2} />
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "currentColor",
            animation: status === "running" ? "pulse-dot 1.1s ease-in-out infinite" : "none",
            boxShadow: status === "running" ? "0 0 0 3px var(--st-run-bg)" : "none",
          }}
        />
      )}
      {m.label}
    </span>
  );
}

// ---------- Stage badges (OCR → LLM → Plan → HTML) ----------
export function StageBadges({
  stages,
  currentStage,
  failedStage,
  compact = false,
}: {
  stages: Record<string, boolean>;
  currentStage?: string | null;
  failedStage?: string | null;
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 2 : 3 }}>
      {BLOOM.STAGES.map((s, i) => {
        const done = stages[s];
        const isCurrent = currentStage === s;
        const isFail = failedStage === s;
        let bg = "var(--surface-3)",
          fg = "var(--text-3)",
          ring = "none";
        if (done) {
          bg = "var(--st-done-bg)";
          fg = "var(--st-done-fg)";
        }
        if (isCurrent) {
          bg = "var(--st-run-bg)";
          fg = "var(--st-run-fg)";
          ring = "0 0 0 1.5px var(--st-run-fg)";
        }
        if (isFail) {
          bg = "var(--st-fail-bg)";
          fg = "var(--st-fail-fg)";
          ring = "0 0 0 1.5px var(--st-fail-fg)";
        }
        return (
          <React.Fragment key={s}>
            <span
              title={
                BLOOM.STAGE_LABELS[s] +
                (done ? " · done" : isCurrent ? " · running" : isFail ? " · failed" : " · pending")
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 18,
                padding: "0 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".3px",
                background: bg,
                color: fg,
                boxShadow: ring,
              }}
            >
              {BLOOM.STAGE_LABELS[s]}
            </span>
            {i < BLOOM.STAGES.length - 1 && (
              <span style={{ color: "var(--text-3)", opacity: 0.5, fontSize: 9 }}>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------- Approve / disapprove mark ----------
export function MarkControl({
  mark,
  onChange,
  size = 15,
}: {
  mark: Mark;
  onChange: (v: Mark) => void;
  size?: number;
}) {
  const opts = [
    {
      v: "good" as Mark,
      icon: "thumbsUp",
      color: "var(--st-done-fg)",
      tint: "var(--st-done-bg)",
      title: "Approve",
    },
    {
      v: "bad" as Mark,
      icon: "thumbsDown",
      color: "var(--bad)",
      tint: "var(--st-disapprove-bg)",
      title: "Disapprove",
    },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 3 }}>
      {opts.map((o) => {
        const on = mark === o.v;
        return (
          <button
            key={o.v}
            title={o.title}
            onClick={(e) => {
              e.stopPropagation();
              onChange(on ? "neutral" : o.v);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 22,
              borderRadius: 5,
              border: "1px solid " + (on ? o.color : "transparent"),
              background: o.tint,
              color: o.color,
              opacity: on ? 1 : 0.6,
              transition: "all .12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = on ? "1" : "0.6";
            }}
          >
            <Icon name={o.icon} size={size} strokeWidth={on ? 2 : 1.6} />
          </button>
        );
      })}
    </div>
  );
}

// ---------- Pin / unpin toggle ----------
export function PinButton({
  pinned,
  onChange,
  size = 14,
}: {
  pinned: boolean;
  onChange: (v: boolean) => void;
  size?: number;
}) {
  return (
    <button
      title={pinned ? "Pinned — click to unpin" : "Pin this run (keep it when re-converting)"}
      aria-pressed={pinned}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!pinned);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 5,
        border: "1px solid transparent",
        background: "transparent",
        color: pinned ? "var(--accent)" : "var(--text-3)",
        opacity: pinned ? 1 : 0.6,
        transition: "all .12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
        if (!pinned) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = pinned ? "1" : "0.6";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon name={pinned ? "pin-filled" : "pin"} size={size} strokeWidth={1.6} />
    </button>
  );
}

// Book thumbnails removed by request — render nothing wherever Thumb was used.
export function Thumb(_props?: { hue?: number; w?: number; h?: number }) {
  return null;
}

// ---------- Progress bar (determinate when `value` 0..1 is given) ----------
export function ProgressBar({
  height = 4,
  value,
}: {
  height?: number;
  value?: number;
  label?: string;
}) {
  const determinate = typeof value === "number";
  return (
    <div style={{ width: "100%" }}>
      <div
        className={determinate ? "" : "indet-bar"}
        style={{
          position: "relative",
          height,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--st-run-bg)",
        }}
      >
        {determinate ? (
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: Math.max(0, Math.min(1, value!)) * 100 + "%",
              borderRadius: 999,
              background: "var(--st-run-fg)",
              transition: "width .3s ease",
            }}
          />
        ) : (
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "40%",
              borderRadius: 999,
              background: "var(--st-run-fg)",
              opacity: 0.85,
              animation: "indet 1.25s cubic-bezier(.5,0,.3,1) infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}

// Overall completion fraction (0..1) for a running run. Stages get weighted
// segments; OCR — the expensive, page-by-page stage — subdivides by page.
const STAGE_WEIGHTS: Record<string, number> = {
  ocr: 0.4,
  llm: 0.4,
  plan: 0.1,
  html: 0.1,
  bloom: 0.15,
};
const TARGET_LAST_STAGE: Record<string, number> = { images: -1, ocr: 0, tagged: 2, bloom: 4 };
export function runProgress(run: Run): number {
  if (run.status === "done") return 1;
  if (run.status !== "running") return 0;
  const order = ["ocr", "llm", "plan", "html", "bloom"];
  const target = (run.params as any)?.target || "bloom";
  const lastIdx = TARGET_LAST_STAGE[target] ?? 4;
  const active = lastIdx < 0 ? [] : order.slice(0, lastIdx + 1);
  if (active.length === 0) return 0.5; // images: no per-stage info to show
  const totalW = active.reduce((a, s) => a + (STAGE_WEIGHTS[s] || 0), 0);
  let frac = 0;
  for (const s of active) {
    const w = (STAGE_WEIGHTS[s] || 0) / totalW;
    if (run.stages[s])
      frac += w; // completed segment
    else if (run.progress?.stage === s && s === "ocr" && run.progress.pages) {
      frac += w * (run.progress.page / run.progress.pages); // subdivide OCR by page
    }
  }
  return Math.min(0.98, frac);
}

// ---------- Buttons ----------
export function Btn({
  children,
  variant = "default",
  size = "md",
  icon,
  iconRight,
  onClick,
  disabled,
  title,
  full,
  active,
  style = {},
}: {
  children?: React.ReactNode;
  variant?: "primary" | "default" | "subtle" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: string;
  iconRight?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  full?: boolean;
  active?: boolean;
  style?: React.CSSProperties;
}) {
  const sizes = {
    sm: { h: 26, px: 9, fs: 12, gap: 5 },
    md: { h: 30, px: 12, fs: 12.5, gap: 6 },
    lg: { h: 36, px: 16, fs: 13.5, gap: 7 },
  }[size];
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: "var(--accent)",
      color: "var(--accent-fg)",
      border: "1px solid transparent",
    },
    default: {
      backgroundColor: "var(--surface)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
    },
    subtle: {
      backgroundColor: "transparent",
      color: "var(--text-2)",
      border: "1px solid transparent",
    },
    ghost: {
      backgroundColor: active ? "var(--surface-3)" : "transparent",
      color: active ? "var(--text)" : "var(--text-2)",
      border: "1px solid transparent",
    },
    danger: {
      backgroundColor: "transparent",
      color: "var(--bad)",
      border: "1px solid color-mix(in oklch, var(--bad) 35%, transparent)",
    },
  };
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: full ? "flex" : "inline-flex",
        width: full ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: sizes.gap,
        height: sizes.h,
        padding: `0 ${sizes.px}px`,
        fontSize: sizes.fs,
        fontWeight: 600,
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "filter .12s, background .12s, border-color .12s",
        ...variants[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.filter = "brightness(0.96)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "none";
      }}
    >
      {icon && <Icon name={icon} size={sizes.fs + 2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={sizes.fs + 2} />}
    </button>
  );
}

// icon-only button
export function IconBtn({
  name,
  onClick,
  title,
  size = 28,
  iconSize = 16,
  active,
  disabled,
  color,
  danger,
  style = {},
}: {
  name: string;
  onClick?: () => void;
  title?: string;
  size?: number;
  iconSize?: number;
  active?: boolean;
  disabled?: boolean;
  color?: string;
  danger?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        background: active ? "var(--surface-3)" : "transparent",
        color: danger ? "var(--bad)" : color || (active ? "var(--text)" : "var(--text-2)"),
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .12s",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) e.currentTarget.style.background = "var(--surface-3)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon name={name} size={iconSize} />
    </button>
  );
}

// ---------- Chip (filter / tag) ----------
export function Chip({
  children,
  active,
  onClick,
  count,
  color,
  removable,
  onRemove,
  dot,
}: {
  children?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  count?: number | null;
  color?: string | null;
  removable?: boolean;
  onRemove?: () => void;
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 25,
        padding: "0 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        border: "1px solid " + (active ? "transparent" : "var(--border-strong)"),
        background: active ? "var(--accent-soft)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--text-2)",
        cursor: "pointer",
        transition: "all .12s",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{ width: 7, height: 7, borderRadius: 999, background: color || "currentColor" }}
        />
      )}
      {children}
      {count != null && (
        <span className="mono" style={{ opacity: 0.65, fontSize: 10.5 }}>
          {count}
        </span>
      )}
      {removable && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove && onRemove();
          }}
          style={{ display: "inline-flex", marginRight: -3, opacity: 0.6 }}
        >
          <Icon name="x" size={11} />
        </span>
      )}
    </button>
  );
}

// ---------- Form controls ----------
export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 5,
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
        {hint && <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  full,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  full?: boolean;
}) {
  return (
    <div style={{ position: "relative", width: full ? "100%" : undefined }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          width: "100%",
          height: 32,
          padding: "0 28px 0 10px",
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--text)",
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        style={{
          position: "absolute",
          right: 9,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--text-3)",
        }}
      >
        <Icon name="chevron-down" size={14} />
      </span>
    </div>
  );
}

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        border: "none",
        background: "transparent",
        padding: 0,
      }}
    >
      <span
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          padding: 2,
          flexShrink: 0,
          background: value ? "var(--accent)" : "var(--border-strong)",
          transition: "background .15s",
          display: "flex",
          justifyContent: value ? "flex-end" : "flex-start",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "#fff",
            boxShadow: "var(--shadow-sm)",
            transition: "all .15s",
          }}
        />
      </span>
      {label && <span style={{ fontSize: 12.5, color: "var(--text)" }}>{label}</span>}
    </button>
  );
}

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: string; title?: string }[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 2,
        gap: 2,
        background: "var(--surface-3)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.title}
            style={{
              height: 24,
              padding: "0 10px",
              borderRadius: 4,
              border: "none",
              fontSize: 11.5,
              fontWeight: 600,
              background: on ? "var(--surface)" : "transparent",
              color: on ? "var(--text)" : "var(--text-3)",
              boxShadow: on ? "var(--shadow-sm)" : "none",
              transition: "all .12s",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {o.icon && <Icon name={o.icon} size={13} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// small "i" info icon with hover tooltip
export function InfoDot({ tip, size = 12 }: { tip: string; size?: number }) {
  return (
    <span
      title={tip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        color: "var(--text-3)",
        cursor: "help",
      }}
    >
      <Icon name="info" size={size} />
    </span>
  );
}

// ---------- Checkbox ----------
export function Check({
  checked,
  indeterminate,
  onChange,
  onClick,
  disabled,
  title,
}: {
  checked?: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        if (onClick) onClick(e);
        if (!disabled) onChange(!checked);
      }}
      disabled={disabled}
      style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        flexShrink: 0,
        border:
          "1.5px solid " + (checked || indeterminate ? "var(--accent)" : "var(--border-strong)"),
        background: checked || indeterminate ? "var(--accent)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.3 : 1,
        transition: "all .1s",
        color: "var(--accent-fg)",
      }}
    >
      {checked && <Icon name="check" size={11} strokeWidth={2.4} />}
      {indeterminate && !checked && (
        <span style={{ width: 8, height: 2, borderRadius: 2, background: "var(--accent-fg)" }} />
      )}
    </button>
  );
}
