/* Central table — source rows expand into run rows (ported from table.jsx) */
import React from "react";
import { Icon } from "../lib/icons";
import { BLOOM } from "../data/mockData";
import {
  StatusPill,
  StageBadges,
  Chip,
  IconBtn,
  Check,
  ProgressBar,
  runProgress,
  fmt,
  STATUS_META,
  effStatus,
} from "./primitives";
import type { Mark, Run, Source } from "../types";

const COLS = "30px minmax(170px,1fr) 124px 186px 92px";

interface CenterTableProps {
  sources: Source[];
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  selectedRunId: string | null;
  onSelectRun: (sid: string, rid: string) => void;
  onSelectPdf: (sid: string) => void;
  focusPdfId: string | null;
  checkedPdfs: Set<string>;
  onCheckPdf: (sid: string, v: boolean) => void;
  checked: Set<string>;
  onCheck: (rid: string, v: boolean) => void;
  onCheckMany: (ids: string[], v: boolean) => void;
  onCheckManyPdfs: (ids: string[], v: boolean) => void;
  onMark: (sid: string, rid: string, v: Mark) => void;
  onCancelRun: (sid: string, rid: string) => void;
  onPreview: (r: Run) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  sort: string;
  sortDir: string;
  onSortClick: (key: string) => void;
  parallelism: number;
  onParallel: (v: number) => void;
  onCleanup: () => void;
  onConfigRun: (s: Source, r: Run) => void;
  onExpandAll: () => void;
  allExpanded: boolean;
}

export function CenterTable(props: CenterTableProps) {
  const {
    sources,
    expanded,
    onToggleExpand,
    selectedRunId,
    onSelectRun,
    onSelectPdf,
    focusPdfId,
    checkedPdfs,
    onCheckPdf,
    checked,
    onCheck,
    onCheckMany,
    onCheckManyPdfs,
    onMark,
    onCancelRun,
    onPreview,
    statusFilter,
    onStatusFilter,
    sort,
    sortDir,
    onSortClick,
    parallelism,
    onParallel,
    onCleanup,
    onConfigRun,
    onExpandAll,
    allExpanded,
  } = props;

  // flatten + filter (book-level, on unified status)
  const visibleSources = sources.filter((s) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "notrun") return s.runs.length === 0;
    if (statusFilter === "needsattn") return !s.runs.some((r) => effStatus(r) === "keeper");
    return s.runs.some((r) => effStatus(r) === statusFilter);
  });

  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...visibleSources].sort((a, b) => {
    let cmp = 0;
    if (sort === "name") cmp = a.name.localeCompare(b.name);
    else if (sort === "date") cmp = (a.runs[0]?.ts || "").localeCompare(b.runs[0]?.ts || "");
    else if (sort === "status") cmp = statusRank(a) - statusRank(b);
    return cmp * dir;
  });

  // runs governed by the master checkbox
  const RUN_STATUSES = ["running", "queued", "failed", "completed", "keeper", "disapproved"];
  const targetRuns: string[] = [];
  sorted.forEach((s) =>
    s.runs.forEach((r) => {
      if (RUN_STATUSES.includes(statusFilter)) {
        if (effStatus(r) === statusFilter) targetRuns.push(r.id);
      } else targetRuns.push(r.id);
    }),
  );
  const allSel = targetRuns.length > 0 && targetRuns.every((id) => checked.has(id));
  const someSel = targetRuns.some((id) => checked.has(id));
  const masterTitle = RUN_STATUSES.includes(statusFilter)
    ? `Select all ${targetRuns.length} ${STATUS_META[statusFilter].label.toLowerCase()} runs`
    : `Select all ${targetRuns.length} runs`;

  // book (PDF) master selection — for batch runs
  const bookIds = sorted.map((s) => s.id);
  const allBooksSel = bookIds.length > 0 && bookIds.every((id) => checkedPdfs.has(id));
  const someBooksSel = bookIds.some((id) => checkedPdfs.has(id));

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "var(--bg)",
      }}
    >
      <Toolbar
        {...{
          statusFilter,
          onStatusFilter,
          onExpandAll,
          allExpanded,
          sources,
          count: sorted.length,
          parallelism,
          onParallel,
          onCleanup,
        }}
      />

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ minWidth: 600 }}>
          {/* header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLS,
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              height: 34,
              position: "sticky",
              top: 0,
              zIndex: 5,
              background: "var(--chrome)",
              borderBottom: "1px solid var(--border)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".5px",
              textTransform: "uppercase",
              color: "var(--text-3)",
            }}
          >
            <Check
              checked={allBooksSel}
              indeterminate={someBooksSel && !allBooksSel}
              disabled={bookIds.length === 0}
              onChange={(v) => onCheckManyPdfs(bookIds, v)}
              title={`Select all ${bookIds.length} books for batch`}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <SortHead
                label="Book / run"
                active={sort === "name"}
                dir={sortDir}
                onClick={() => onSortClick("name")}
              />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check
                  checked={allSel}
                  indeterminate={someSel && !allSel}
                  disabled={targetRuns.length === 0}
                  onChange={(v) => onCheckMany(targetRuns, v)}
                  title={masterTitle}
                />
                <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-3)" }}>runs</span>
              </span>
            </div>
            <SortHead
              label="Status"
              active={sort === "status"}
              dir={sortDir}
              onClick={() => onSortClick("status")}
            />
            <span>Stages</span>
            <SortHead
              label="Date"
              active={sort === "date"}
              dir={sortDir}
              onClick={() => onSortClick("date")}
              align="right"
            />
          </div>

          {sorted.length === 0 && (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-3)" }}>
              <Icon name="filter" size={26} strokeWidth={1.2} />
              <p style={{ fontSize: 12.5, marginTop: 10 }}>No books match these filters.</p>
            </div>
          )}

          {sorted.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              expanded={expanded.has(s.id)}
              onToggleExpand={() => onToggleExpand(s.id)}
              onSelectPdf={onSelectPdf}
              pdfSelected={focusPdfId === s.id}
              pdfChecked={checkedPdfs.has(s.id)}
              onCheckPdf={onCheckPdf}
              checked={checked}
              onCheck={onCheck}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              onMark={onMark}
              onCancelRun={onCancelRun}
              onPreview={onPreview}
              onConfigRun={onConfigRun}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// clickable, sort-aware column header
function SortHead({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: string;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <button
      onClick={onClick}
      title={`Sort by ${label.toLowerCase()}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        font: "inherit",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".5px",
        textTransform: "uppercase",
        color: active ? "var(--text)" : "var(--text-3)",
        width: align === "right" ? "100%" : undefined,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      {label}
      <span style={{ display: "inline-flex", opacity: active ? 1 : 0.25 }}>
        <Icon
          name="chevron-down"
          size={11}
          style={{
            transform: active && dir === "asc" ? "rotate(180deg)" : "none",
            transition: "transform .12s",
          }}
        />
      </span>
    </button>
  );
}

const stepBtn: React.CSSProperties = {
  width: 20,
  height: 22,
  border: "none",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 14,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function statusRank(s: Source) {
  if (s.runs.some((r) => r.status === "running")) return 6;
  if (s.runs.some((r) => r.status === "queued")) return 5;
  if (s.runs.some((r) => r.status === "failed")) return 4;
  if (s.runs.some((r) => effStatus(r) === "disapproved")) return 3;
  if (s.runs.some((r) => effStatus(r) === "completed")) return 2;
  if (s.runs.some((r) => effStatus(r) === "keeper")) return 1;
  return 0;
}

// ---------- Toolbar ----------
interface FilterOption {
  value: string;
  label: string;
  st?: string;
  count: number;
}

function Toolbar({
  statusFilter,
  onStatusFilter,
  onExpandAll,
  allExpanded,
  count,
  sources,
  parallelism,
  onParallel,
  onCleanup,
}: {
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  onExpandAll: () => void;
  allExpanded: boolean;
  count: number;
  sources: Source[];
  parallelism: number;
  onParallel: (v: number) => void;
  onCleanup: () => void;
}) {
  const n = (fn: (s: Source) => boolean) => sources.filter(fn).length;
  const has = (s: Source, eff: string) => s.runs.some((r) => effStatus(r) === eff);
  const options: FilterOption[] = [
    { value: "all", label: "All books", count: sources.length },
    { value: "needsattn", label: "Needs attention", count: n((s) => !has(s, "keeper")) },
    { value: "notrun", label: "Not run", st: "idle", count: n((s) => s.runs.length === 0) },
    { value: "queued", label: "Queued", st: "queued", count: n((s) => has(s, "queued")) },
    { value: "running", label: "Running", st: "run", count: n((s) => has(s, "running")) },
    { value: "failed", label: "Failed", st: "fail", count: n((s) => has(s, "failed")) },
    {
      value: "completed",
      label: "Awaiting Review",
      st: "keeper",
      count: n((s) => has(s, "completed")),
    },
    { value: "keeper", label: "Approved", st: "done", count: n((s) => has(s, "keeper")) },
    {
      value: "disapproved",
      label: "Disapproved",
      st: "disapprove",
      count: n((s) => has(s, "disapproved")),
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        flexWrap: "wrap",
      }}
    >
      <FilterMenu options={options} value={statusFilter} onChange={onStatusFilter} />
      <span style={{ fontSize: 11, color: "var(--text-3)" }} className="mono">
        {count} of {sources.length} books
      </span>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>
            Max concurrent
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          >
            <button
              onClick={() => onParallel(parallelism - 1)}
              title="Fewer concurrent runs"
              style={stepBtn}
            >
              –
            </button>
            <span
              className="mono"
              style={{
                width: 18,
                textAlign: "center",
                fontSize: 11.5,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {parallelism}
            </span>
            <button
              onClick={() => onParallel(parallelism + 1)}
              title="More concurrent runs"
              style={stepBtn}
            >
              +
            </button>
          </div>
        </div>
        <button
          onClick={onCleanup}
          title="Remove failed & disapproved runs, delete previews from the collection, and reload Bloom"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 26,
            padding: "0 9px",
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          <Icon name="trash" size={13} />
          Cleanup
        </button>
        <IconBtn
          name="layers"
          title={allExpanded ? "Collapse all" : "Expand all"}
          active={allExpanded}
          onClick={onExpandAll}
        />
      </div>
    </div>
  );
}

// Compact filter dropdown (replaces the prominent chip row).
function FilterMenu({
  options,
  value,
  onChange,
}: {
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.value === value) || options[0];
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 9px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: value === "all" ? "var(--surface)" : "var(--accent-soft)",
          color: value === "all" ? "var(--text-2)" : "var(--accent)",
          fontSize: 11.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Icon name="filter" size={12} />
        <span>{cur.label}</span>
        <span className="mono" style={{ opacity: 0.6, fontSize: 10.5 }}>
          {cur.count}
        </span>
        <Icon name="chevron-down" size={12} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
          <div
            className="scale-in"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 31,
              minWidth: 210,
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              padding: 4,
            }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: value === o.value ? "var(--accent-soft)" : "transparent",
                  color: value === o.value ? "var(--accent)" : "var(--text-2)",
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                {o.st ? (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: `var(--st-${o.st}-fg)`,
                    }}
                  />
                ) : (
                  <Icon
                    name={o.value === "needsattn" ? "flag" : "filter"}
                    size={11}
                    style={{ opacity: 0.6 }}
                  />
                )}
                <span style={{ flex: 1 }}>{o.label}</span>
                <span className="mono" style={{ opacity: 0.6, fontSize: 10.5 }}>
                  {o.count}
                </span>
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

// ---------- Source (PDF/book) row ----------
function SourceRow({
  source,
  expanded,
  onToggleExpand,
  onSelectPdf,
  pdfSelected,
  pdfChecked,
  onCheckPdf,
  checked,
  onCheck,
  selectedRunId,
  onSelectRun,
  onMark,
  onCancelRun,
  onPreview,
  onConfigRun,
}: {
  source: Source;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectPdf: (sid: string) => void;
  pdfSelected: boolean;
  pdfChecked: boolean;
  onCheckPdf: (sid: string, v: boolean) => void;
  checked: Set<string>;
  onCheck: (rid: string, v: boolean) => void;
  selectedRunId: string | null;
  onSelectRun: (sid: string, rid: string) => void;
  onMark: (sid: string, rid: string, v: Mark) => void;
  onCancelRun: (sid: string, rid: string) => void;
  onPreview: (r: Run) => void;
  onConfigRun: (s: Source, r: Run) => void;
}) {
  const runs = source.runs;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        borderLeft: "3px solid " + (pdfSelected ? "var(--accent)" : "transparent"),
      }}
    >
      {/* source header row — click selects the PDF */}
      <div
        onClick={() => onSelectPdf(source.id)}
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          minHeight: "var(--row-h)",
          cursor: "pointer",
          background: pdfSelected
            ? "color-mix(in oklch, var(--accent) 18%, var(--surface))"
            : expanded
              ? "var(--surface-2)"
              : "var(--surface)",
          transition: "background .1s",
        }}
        onMouseEnter={(e) => {
          if (!pdfSelected && !expanded) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!pdfSelected && !expanded) e.currentTarget.style.background = "var(--surface)";
        }}
      >
        <Check
          checked={pdfChecked}
          onChange={(v) => onCheckPdf(source.id, v)}
          onClick={(e) => e.stopPropagation()}
          title="Select book for batch run"
        />
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            title={expanded ? "Collapse runs" : "Show runs"}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              display: "inline-flex",
              cursor: "pointer",
              color: "var(--text-3)",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform .14s",
              visibility: runs.length ? "visible" : "hidden",
            }}
          >
            <Icon name="chevron" size={13} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {source.name}
            </div>
            {runs.length > 0 && (
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                {runs.length} run{runs.length > 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>
        <div>
          <StatusPill status={bookStatus(source)} size="sm" />
        </div>
        <div></div>
        <div></div>
      </div>

      {/* run rows */}
      {expanded &&
        runs.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            checked={checked.has(r.id)}
            onCheck={(v) => onCheck(r.id, v)}
            selected={selectedRunId === r.id}
            onSelect={() => onSelectRun(source.id, r.id)}
          />
        ))}
      {expanded && runs.length === 0 && (
        <div
          style={{
            padding: "10px 14px 12px 60px",
            fontSize: 11.5,
            color: "var(--text-3)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="info" size={13} /> No runs yet — select this book to start one.
        </div>
      )}
    </div>
  );
}

export function bookStatus(source: Source) {
  const runs = source.runs;
  if (!runs.length) return "notrun";
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "queued")) return "queued";
  if (runs.some((r) => effStatus(r) === "keeper")) return "keeper";
  return effStatus(runs[0]); // most recent run (failed / disapproved / completed)
}

/** A concise amalgamation of the settings a run used (shown instead of the
 *  opaque run id, which becomes a small suffix). */
function runSummary(run: Run): string {
  const p: any = run.params || {};
  const parts: string[] = [];
  if (p.ocrMethod) parts.push((BLOOM.ocrMethods[p.ocrMethod] || p.ocrMethod).split(" ")[0]);
  if (p.model) parts.push((BLOOM.MODELS[p.model]?.label || p.model).replace(" (default)", ""));
  parts.push(p.visionFormatting === false ? "no-vision" : "vision");
  if (p.complexBecomesImage && p.complexBecomesImage !== "off")
    parts.push("flat≥" + p.complexBecomesImage);
  if (p.target) parts.push("→ " + (BLOOM.targets[p.target] || p.target));
  return parts.join(" · ") || run.id;
}

// ---------- Run row ----------
function RunRow({
  run,
  checked,
  onCheck,
  selected,
  onSelect,
}: {
  run: Run;
  checked: boolean;
  onCheck: (v: boolean) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const running = run.status === "running";
  const failed = run.status === "failed";
  const selBg = "color-mix(in oklch, var(--accent) 18%, var(--surface))";
  return (
    <div
      style={{
        background: selected ? selBg : "transparent",
        borderLeft: "3px solid " + (selected ? "var(--accent)" : "transparent"),
      }}
    >
      <div
        onClick={onSelect}
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          alignItems: "center",
          gap: 8,
          padding: "0 14px 0 12px",
          minHeight: "var(--row-h)",
          cursor: "pointer",
          transition: "background .1s",
          background: selected ? selBg : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!selected) e.currentTarget.style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!selected) e.currentTarget.style.background = "transparent";
        }}
      >
        <Check checked={checked} onChange={onCheck} onClick={(e) => e.stopPropagation()} />
        {/* run label + indent */}
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 6, paddingLeft: 30, minWidth: 0 }}
        >
          <span
            style={{
              width: 10,
              height: 1,
              background: "var(--border-strong)",
              flexShrink: 0,
              marginLeft: -16,
              alignSelf: "center",
            }}
          />
          <span
            title={runSummary(run)}
            style={{
              fontSize: 11.5,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {runSummary(run)}
          </span>
          <span className="mono" style={{ fontSize: 9, color: "var(--text-3)", flexShrink: 0 }}>
            {run.id}
          </span>
        </div>
        <div title={failed && run.error ? run.error.message : undefined}>
          <StatusPill status={effStatus(run)} size="sm" />
        </div>
        <div>
          <StageBadges
            stages={run.stages}
            currentStage={running && run.progress ? run.progress.stage : null}
            failedStage={failed && run.error ? run.error.stage : null}
            compact
          />
        </div>
        <div
          className="metric"
          style={{ textAlign: "right", fontSize: 10.5, color: "var(--text-3)" }}
        >
          {fmt.date(run.ts)}
        </div>
      </div>
      {/* live progress sub-row */}
      {running && run.progress && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px 8px 56px" }}>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--st-run-fg)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {BLOOM.STAGE_LABELS[run.progress.stage]}
            {run.progress.pages ? ` · page ${run.progress.page}/${run.progress.pages}` : ""}
          </span>
          <div style={{ flex: 1, maxWidth: 320 }}>
            <ProgressBar value={runProgress(run)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Bulk action bar ----------
export function BulkBar({
  count,
  onRun,
  onCancel,
  onDelete,
  onMarkGood,
  onMarkBad,
  onClear,
}: {
  count: number;
  onRun: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onMarkGood: () => void;
  onMarkBad: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div
      className="scale-in"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "7px 8px 7px 14px",
        background: "var(--text)",
        color: "var(--bg)",
        borderRadius: 12,
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, marginRight: 4 }}>
        {count} run{count > 1 ? "s" : ""} selected
      </span>
      <span
        style={{ width: 1, height: 20, background: "currentColor", opacity: 0.25, margin: "0 4px" }}
      />
      <BulkBtn icon="play" label="Run" onClick={onRun} />
      <BulkBtn icon="stop" label="Cancel" onClick={onCancel} />
      <BulkBtn icon="thumbsUp" label="Approve" onClick={onMarkGood} />
      <BulkBtn icon="thumbsDown" label="Disapprove" onClick={onMarkBad} />
      <BulkBtn icon="trash" label="Delete" onClick={onDelete} danger />
      <span
        style={{ width: 1, height: 20, background: "currentColor", opacity: 0.25, margin: "0 4px" }}
      />
      <button
        onClick={onClear}
        title="Clear selection"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "none",
          background: "transparent",
          color: "inherit",
          opacity: 0.7,
          cursor: "pointer",
          borderRadius: 7,
        }}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
function BulkBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 11px",
        border: "none",
        borderRadius: 7,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        background: "color-mix(in oklch, var(--bg) 14%, transparent)",
        color: danger ? "var(--bad)" : "inherit",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "color-mix(in oklch, var(--bg) 26%, transparent)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "color-mix(in oklch, var(--bg) 14%, transparent)")
      }
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
