/* Dev tweaks panel — replaces the prototype's editor harness with a small,
   localStorage-backed control panel for theme/density/accent and demo state.
   This is a development affordance; the demo-state switcher exists because there
   is no backend yet. */
import React from "react";
import { Icon } from "../lib/icons";

export type Tweaks = {
  dark: boolean;
  accentHue: number;
  density: string;
  metricFont: string;
  configMode: string;
  demoState: string;
};

const STORE_KEY = "pdf2bloom.tweaks";

export function useTweaks(defaults: Tweaks): [Tweaks, (k: keyof Tweaks, v: any) => void] {
  const [t, setT] = React.useState<Tweaks>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      /* ignore */
    }
    return defaults;
  });
  const setTweak = (k: keyof Tweaks, v: any) =>
    setT((o) => {
      const next = { ...o, [k]: v };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch (e) {
        /* ignore */
      }
      return next;
    });
  return [t, setTweak];
}

const ACCENTS = [
  { hue: 256, name: "Indigo" },
  { hue: 248, name: "Blue" },
  { hue: 200, name: "Cyan" },
  { hue: 162, name: "Teal" },
  { hue: 145, name: "Green" },
  { hue: 300, name: "Violet" },
];

function TweaksPanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open dev tweaks"
        style={{
          position: "fixed",
          right: 14,
          bottom: 44,
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "1px solid var(--border-strong)",
          background: "var(--surface)",
          color: "var(--text-2)",
          boxShadow: "var(--shadow-md)",
          cursor: "pointer",
        }}
      >
        <Icon name="sliders" size={16} />
      </button>
    );
  }
  return (
    <div
      style={{
        position: "fixed",
        right: 14,
        bottom: 44,
        zIndex: 200,
        width: 248,
        maxHeight: "70vh",
        overflowY: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".5px",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {title}
        </span>
        <button
          onClick={() => setOpen(false)}
          title="Close"
          style={{
            display: "inline-flex",
            border: "none",
            background: "transparent",
            color: "var(--text-3)",
            cursor: "pointer",
          }}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      {children}
    </div>
  );
}

function TweakSection({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".5px",
        textTransform: "uppercase",
        color: "var(--text-3)",
        margin: "12px 0 6px",
      }}
    >
      {label}
    </div>
  );
}

function TweakRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "4px 0",
      }}
    >
      <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{label}</span>
      {children}
    </div>
  );
}

function TweakSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <TweakRow label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          maxWidth: 130,
          height: 24,
          fontSize: 11,
          background: "var(--surface-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </TweakRow>
  );
}

function TweakRadio({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <div
        style={{
          display: "inline-flex",
          padding: 2,
          gap: 2,
          background: "var(--surface-3)",
          borderRadius: 5,
        }}
      >
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              style={{
                height: 22,
                padding: "0 8px",
                borderRadius: 4,
                border: "none",
                fontSize: 10.5,
                fontWeight: 600,
                background: on ? "var(--surface)" : "transparent",
                color: on ? "var(--text)" : "var(--text-3)",
                boxShadow: on ? "var(--shadow-sm)" : "none",
                cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <TweakRow label={label}>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          padding: 2,
          border: "none",
          background: value ? "var(--accent)" : "var(--border-strong)",
          display: "flex",
          justifyContent: value ? "flex-end" : "flex-start",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "#fff",
            boxShadow: "var(--shadow-sm)",
          }}
        />
      </button>
    </TweakRow>
  );
}

export function TweakUI({
  t,
  setTweak,
}: {
  t: Tweaks;
  setTweak: (k: keyof Tweaks, v: any) => void;
}) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Run configuration" />
      <TweakRadio
        label="Config surface"
        value={t.configMode}
        options={[
          { value: "modal", label: "Modal" },
          { value: "drawer", label: "Panel" },
        ]}
        onChange={(v) => setTweak("configMode", v)}
      />

      <TweakSection label="Appearance" />
      <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
      <TweakRow label="Accent">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ACCENTS.map((a) => (
            <button
              key={a.hue}
              title={a.name}
              onClick={() => setTweak("accentHue", a.hue)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                cursor: "pointer",
                background: `oklch(0.58 0.15 ${a.hue})`,
                border: "2px solid " + (t.accentHue === a.hue ? "var(--text)" : "transparent"),
                outline: t.accentHue === a.hue ? "1px solid var(--text)" : "none",
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      </TweakRow>
      <TweakRadio
        label="Row density"
        value={t.density}
        options={[
          { value: "compact", label: "S" },
          { value: "regular", label: "M" },
          { value: "comfy", label: "L" },
        ]}
        onChange={(v) => setTweak("density", v)}
      />
      <TweakRadio
        label="Metric font"
        value={t.metricFont}
        options={[
          { value: "mono", label: "Mono" },
          { value: "sans", label: "Sans" },
        ]}
        onChange={(v) => setTweak("metricFont", v)}
      />
    </TweaksPanel>
  );
}
