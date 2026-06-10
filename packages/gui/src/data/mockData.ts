/* BloomBridge · mock data (ported from the design prototype's data.js).
   Exported as BLOOM; the server will later supply these same shapes. */
import type {
  ArtifactNode,
  ModelInfo,
  Params,
  RecentFolder,
  Run,
  Source,
  Stage,
  StageBreakdown,
} from "../types";

const MODELS: Record<string, ModelInfo> = {
  "google/gemini-3.1-pro-preview": { label: "Gemini 3.1 Pro (default)", inCost: 0, outCost: 0 },
  "claude-sonnet-4": { label: "Claude Sonnet 4", inCost: 3, outCost: 15 },
  "gpt-4o": { label: "GPT-4o", inCost: 2.5, outCost: 10 },
  "gpt-4o-mini": { label: "GPT-4o mini", inCost: 0.15, outCost: 0.6 },
  "gemini-2-flash": { label: "Gemini 2.0 Flash", inCost: 0.1, outCost: 0.4 },
};

const STAGES: Stage[] = ["ocr", "llm", "plan", "html", "bloom"];
const STAGE_LABELS: Record<Stage, string> = {
  ocr: "OCR",
  llm: "Think",
  plan: "Plan",
  html: "HTML",
  bloom: "Bloom",
};

// helper to build a run
let _rid = 100;
function run(o: Partial<Run>): Run {
  return Object.assign(
    {
      id: "r" + _rid++,
      status: "done",
      mark: "neutral",
      stages: { ocr: true, llm: true, plan: true, html: true, bloom: true },
      model: "claude-sonnet-4",
      ocrMethod: "gpt",
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      time: 0,
      ts: "2026-06-03 14:22",
      notes: "",
      tags: [],
      params: {} as Params,
      preset: "balanced",
      breakdown: [],
    },
    o,
  ) as Run;
}

type Quad = [number, number, number, number];
function bd(ocr: Quad, llm: Quad, plan: Quad, html: Quad): StageBreakdown[] {
  return [
    { stage: "ocr", dur: ocr[0], tin: ocr[1], tout: ocr[2], cost: ocr[3] },
    { stage: "llm", dur: llm[0], tin: llm[1], tout: llm[2], cost: llm[3] },
    { stage: "plan", dur: plan[0], tin: plan[1], tout: plan[2], cost: plan[3] },
    { stage: "html", dur: html[0], tin: html[1], tout: html[2], cost: html[3] },
  ];
}

const DEFAULT_PARAMS: Params = {
  ocrMethod: "gpt",
  model: "claude-sonnet-4",
  visionFormatting: true,
  visionModel: "gpt-4o-mini",
  coverMode: "auto",
  complexBecomesImage: "busy",
  trimWhitespace: true,
  target: "bloom",
};

const sources: Source[] = [
  {
    id: "s1",
    name: "The Clever Tortoise",
    file: "clever-tortoise.pdf",
    pages: 12,
    size: "4.2 MB",
    lang: "English",
    added: "2026-06-02",
    hue: 28,
    runs: [
      run({
        id: "r1",
        status: "done",
        mark: "good",
        model: "claude-sonnet-4",
        tokensIn: 48200,
        tokensOut: 12400,
        cost: 0.331,
        time: 184,
        ts: "2026-06-03 14:22",
        preset: "balanced",
        notes: "Best so far — captions clean, cover detected.",
        tags: [],
        params: { ...DEFAULT_PARAMS },
        breakdown: bd(
          [22, 0, 0, 0],
          [121, 42000, 11200, 0.294],
          [24, 5200, 1100, 0.032],
          [17, 1000, 100, 0.005],
        ),
      }),
      run({
        id: "r2",
        status: "done",
        mark: "bad",
        model: "gpt-4o-mini",
        tokensIn: 51100,
        tokensOut: 9800,
        cost: 0.014,
        time: 96,
        ts: "2026-06-03 11:08",
        preset: "fast-cheap",
        notes: "Cheap but garbled diacritics on p.7–9.",
        params: {
          ...DEFAULT_PARAMS,
          model: "gpt-4o-mini",
          visionFormatting: false,
          complexBecomesImage: "anyCanvas",
        },
        breakdown: bd(
          [21, 0, 0, 0],
          [48, 44000, 8400, 0.012],
          [15, 6100, 1200, 0.001],
          [12, 1000, 200, 0.001],
        ),
      }),
      run({
        id: "r3",
        status: "done",
        mark: "neutral",
        model: "gpt-4o",
        tokensIn: 49500,
        tokensOut: 13100,
        cost: 0.255,
        time: 162,
        ts: "2026-06-02 16:40",
        preset: "balanced",
        notes: "",
        params: { ...DEFAULT_PARAMS, model: "gpt-4o" },
        breakdown: bd(
          [23, 0, 0, 0],
          [104, 43000, 11600, 0.224],
          [22, 5500, 1300, 0.027],
          [13, 1000, 200, 0.004],
        ),
      }),
    ],
  },
  {
    id: "s2",
    name: "Counting Mangoes",
    file: "counting-mangoes.pdf",
    pages: 8,
    size: "2.1 MB",
    lang: "Swahili",
    added: "2026-06-02",
    hue: 145,
    runs: [
      run({
        id: "r4",
        status: "running",
        mark: "neutral",
        model: "claude-sonnet-4",
        tokensIn: 18400,
        tokensOut: 3100,
        cost: 0.102,
        time: 71,
        ts: "2026-06-04 09:31",
        stages: { ocr: true, llm: true, plan: false, html: false, bloom: false },
        progress: { stage: "llm", page: 3, pages: 8 },
        preset: "balanced",
        params: { ...DEFAULT_PARAMS },
        breakdown: bd([14, 0, 0, 0], [57, 16800, 3100, 0.102], [0, 0, 0, 0], [0, 0, 0, 0]),
      }),
      run({
        id: "r5",
        status: "done",
        mark: "neutral",
        model: "gemini-2-flash",
        tokensIn: 31200,
        tokensOut: 6900,
        cost: 0.006,
        time: 58,
        ts: "2026-06-03 18:02",
        preset: "fast-cheap",
        params: { ...DEFAULT_PARAMS, model: "gemini-2-flash" },
        breakdown: bd(
          [12, 0, 0, 0],
          [34, 28000, 6100, 0.005],
          [8, 3200, 700, 0.001],
          [4, 1000, 100, 0],
        ),
      }),
    ],
  },
  {
    id: "s3",
    name: "Rain on the Roof",
    file: "rain-on-the-roof.pdf",
    pages: 16,
    size: "6.8 MB",
    lang: "English",
    added: "2026-06-01",
    hue: 235,
    runs: [
      run({
        id: "r6",
        status: "running",
        mark: "neutral",
        model: "claude-sonnet-4",
        tokensIn: 9200,
        tokensOut: 400,
        cost: 0.034,
        time: 22,
        ts: "2026-06-04 09:33",
        stages: { ocr: true, llm: false, plan: false, html: false, bloom: false },
        progress: { stage: "ocr", page: 11, pages: 16 },
        preset: "high-fidelity",
        params: { ...DEFAULT_PARAMS, complexBecomesImage: "covers", coverMode: "render" },
        breakdown: bd([22, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]),
      }),
    ],
  },
  {
    id: "s4",
    name: "My First Words",
    file: "my-first-words.pdf",
    pages: 6,
    size: "1.4 MB",
    lang: "English",
    added: "2026-06-01",
    hue: 320,
    runs: [],
  },
  {
    id: "s5",
    name: "The Lost Goat",
    file: "the-lost-goat.pdf",
    pages: 20,
    size: "9.1 MB",
    lang: "Amharic",
    added: "2026-05-31",
    hue: 12,
    runs: [
      run({
        id: "r7",
        status: "failed",
        mark: "neutral",
        model: "gpt-4o",
        tokensIn: 22800,
        tokensOut: 2100,
        cost: 0.072,
        time: 64,
        ts: "2026-06-04 08:50",
        stages: { ocr: true, llm: true, plan: false, html: false, bloom: false },
        error: {
          stage: "plan",
          code: "PLAN_SCHEMA_INVALID",
          message:
            "Layout planner returned malformed JSON for page 14 (unterminated string). The page likely contains a full-bleed illustration the model tried to describe verbatim.",
        },
        preset: "balanced",
        params: { ...DEFAULT_PARAMS, model: "gpt-4o", complexBecomesImage: "all" },
        breakdown: bd([28, 0, 0, 0], [36, 21200, 2100, 0.072], [0, 0, 0, 0], [0, 0, 0, 0]),
      }),
    ],
  },
  {
    id: "s6",
    name: "Songs of the River",
    file: "songs-of-the-river.pdf",
    pages: 24,
    size: "11.3 MB",
    lang: "Lingala",
    added: "2026-05-30",
    hue: 195,
    runs: [
      run({
        id: "r8",
        status: "queued",
        mark: "neutral",
        model: "claude-sonnet-4",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        time: 0,
        ts: "2026-06-04 09:34",
        stages: { ocr: false, llm: false, plan: false, html: false, bloom: false },
        preset: "high-fidelity",
        params: { ...DEFAULT_PARAMS, complexBecomesImage: "covers" },
      }),
    ],
  },
  {
    id: "s7",
    name: "Grandmother's Garden",
    file: "grandmothers-garden.pdf",
    pages: 10,
    size: "3.6 MB",
    lang: "English",
    added: "2026-05-29",
    hue: 95,
    runs: [
      run({
        id: "r9",
        status: "done",
        mark: "good",
        model: "claude-sonnet-4",
        tokensIn: 40100,
        tokensOut: 10800,
        cost: 0.282,
        time: 151,
        ts: "2026-05-29 13:11",
        preset: "balanced",
        tags: ["published"],
        params: { ...DEFAULT_PARAMS },
        breakdown: bd(
          [19, 0, 0, 0],
          [98, 35000, 9800, 0.252],
          [20, 4100, 900, 0.026],
          [14, 1000, 100, 0.004],
        ),
      }),
    ],
  },
  {
    id: "s8",
    name: "Where Is Kofi?",
    file: "where-is-kofi.pdf",
    pages: 14,
    size: "5.0 MB",
    lang: "Twi",
    added: "2026-05-28",
    hue: 55,
    runs: [
      run({
        id: "r10",
        status: "queued",
        mark: "neutral",
        stages: { ocr: false, llm: false, plan: false, html: false, bloom: false },
        ts: "2026-06-04 09:34",
        preset: "balanced",
        params: { ...DEFAULT_PARAMS },
      }),
      run({
        id: "r11",
        status: "done",
        mark: "neutral",
        model: "gpt-4o-mini",
        tokensIn: 36900,
        tokensOut: 7400,
        cost: 0.01,
        time: 72,
        ts: "2026-05-28 10:05",
        preset: "fast-cheap",
        params: { ...DEFAULT_PARAMS, model: "gpt-4o-mini" },
        breakdown: bd(
          [16, 0, 0, 0],
          [38, 32000, 6600, 0.008],
          [10, 3900, 700, 0.001],
          [8, 1000, 100, 0.001],
        ),
      }),
    ],
  },
];

const presets: Record<string, { label: string; desc: string; params: Params }> = {
  balanced: {
    label: "Balanced",
    desc: "Sonnet 4 + GPT OCR, vision formatting on.",
    params: { ...DEFAULT_PARAMS },
  },
  "fast-cheap": {
    label: "Fast & cheap",
    desc: "GPT-4o mini, formatting off, flatten readily.",
    params: {
      ...DEFAULT_PARAMS,
      model: "gpt-4o-mini",
      visionFormatting: false,
      complexBecomesImage: "anyCanvas",
    },
  },
  "high-fidelity": {
    label: "High fidelity",
    desc: "Sonnet 4, keep complex pages as images.",
    params: { ...DEFAULT_PARAMS, complexBecomesImage: "covers", coverMode: "render" },
  },
};

const recentFolders: RecentFolder[] = [
  { path: "~/Bloom/incoming-pdfs", count: 8, active: true },
  { path: "~/Bloom/SIL-LEAD-batch-2", count: 31 },
  { path: "~/Downloads/scanned-readers", count: 12 },
  { path: "~/Documents/Uganda-pilot", count: 5 },
];

const artifactTree: ArtifactNode[] = [
  {
    type: "dir",
    name: "ocr",
    open: true,
    children: [
      {
        type: "file",
        name: "page-001.txt",
        size: "1.2 KB",
        kind: "text",
        body: "THE CLEVER TORTOISE\n\nLong ago, in a dry land, the animals were very thirsty.\nThere had been no rain for many months.",
      },
      {
        type: "file",
        name: "page-002.txt",
        size: "0.9 KB",
        kind: "text",
        body: 'Tortoise had an idea. "I will dig a well," he said.\nThe other animals laughed at slow, small Tortoise.',
      },
      {
        type: "file",
        name: "page-003.txt",
        size: "1.1 KB",
        kind: "text",
        body: "But Tortoise dug and dug, day after day,\nuntil at last cool water filled the hole.",
      },
    ],
  },
  {
    type: "dir",
    name: "images",
    open: true,
    children: [
      { type: "file", name: "cover.png", size: "820 KB", kind: "image", hue: 28 },
      { type: "file", name: "page-004-illus.png", size: "640 KB", kind: "image", hue: 200 },
      { type: "file", name: "page-009-illus.png", size: "712 KB", kind: "image", hue: 95 },
    ],
  },
  {
    type: "file",
    name: "plan.json",
    size: "3.4 KB",
    kind: "code",
    body: '{\n  "title": "The Clever Tortoise",\n  "language": "en",\n  "cover": { "image": "images/cover.png", "title": true },\n  "pages": [\n    { "n": 1, "layout": "text-over-image", "image": "images/page-001.png" },\n    { "n": 2, "layout": "image-left-text-right" }\n  ]\n}',
  },
  {
    type: "file",
    name: "book.htm",
    size: "18 KB",
    kind: "code",
    body: '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8">\n<title>The Clever Tortoise</title></head>\n<body class="bloom-page">\n  <div class="bloom-page cover">\n    <div class="bloom-imageContainer">…</div>\n  </div>\n</body>\n</html>',
  },
  {
    type: "file",
    name: "run.log",
    size: "6.1 KB",
    kind: "text",
    body: "[09:31:02] OCR  start (google-vision)\n[09:31:24] OCR  done · 12 pages · 22.0s\n[09:31:24] LLM  start (claude-sonnet-4)\n[09:33:25] LLM  done · 42,000 in / 11,200 out · 121.0s\n[09:33:25] PLAN start\n[09:33:49] PLAN done · 24.0s\n[09:33:49] HTML start\n[09:34:06] HTML done · 17.0s\n[09:34:06] RUN  complete · $0.331 · 184.0s total",
  },
];

// The fixed set of extracted-metadata items a user reviews, in display order.
// The keys MUST match the server's CHECKLIST_ITEMS (engine.ts); this list is the
// denominator for the "all thumbs-up" review status and supplies labels in the UI.
const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "illustrator", label: "Illustrator" },
  { key: "copyright", label: "Copyright" },
  { key: "license", label: "License" },
  { key: "licenseNotes", label: "License Notes" },
  { key: "funding", label: "Funding / Acknowledgments" },
  { key: "isbn", label: "ISBN" },
  { key: "publisher", label: "Publisher" },
  { key: "languages", label: "Languages" },
  { key: "pageSize", label: "Paper Size & Orientation" },
  { key: "textPlacement", label: "Text Placement" },
  { key: "textSize", label: "Text Size" },
  { key: "font", label: "Font" },
];

export const BLOOM = {
  MODELS,
  STAGES,
  STAGE_LABELS,
  CHECKLIST_ITEMS,
  DEFAULT_PARAMS,
  sources,
  presets,
  recentFolders,
  artifactTree,
  // --ocr method
  ocrMethods: {
    gpt: "GPT (OpenRouter vision)",
    mistral: "Mistral OCR",
    unpdf: "unpdf (local, no API)",
  } as Record<string, string>,
  // --cover mode
  coverModes: {
    auto: "Auto-detect full-bleed",
    render: "Always render (first + last)",
    none: "Leave to Bloom xMatter",
  } as Record<string, string>,
  // --complex-becomes-image: which pages to snapshot instead of rebuilding as
  // editable text (translatability ↔ fidelity). Additive: each includes the prior.
  complexLevels: {
    covers: "Only image covers",
    busy: "Image covers + pages too busy to convert well",
    anyCanvas: "Image covers + any page with text over a picture",
    all: "All pages (maximum fidelity)",
  } as Record<string, string>,
  complexOrder: ["covers", "busy", "anyCanvas", "all"],
  // --target output artifact
  targets: {
    images: "Images (extract only)",
    ocr: "OCR markdown",
    tagged: "Tagged markdown",
    bloom: "Bloom HTML",
  } as Record<string, string>,
  targetOrder: ["images", "ocr", "tagged", "bloom"],
};
