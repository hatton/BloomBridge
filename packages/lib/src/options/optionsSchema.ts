/**
 * Options manifest — the single source of truth for conversion parameters,
 * their defaults, help text, and UI dependencies. Consumed by:
 *   - the CLI (default values + help),
 *   - the server (exposed at GET /api/options-schema),
 *   - the GUI (renders the config panel + computes "differs from default").
 *
 * Keep this in sync with `packages/cli/src/index.ts` flags and the `Arguments`
 * type in `packages/cli/src/process.ts`.
 */

export type OptionType = "method" | "model" | "enum" | "boolean" | "string" | "path" | "number";

export interface OptionSpec {
  /** stable key used by the GUI params object and run.json */
  key: string;
  /** the CLI flag this maps to, e.g. "--ocr" */
  cliFlag: string;
  label: string;
  type: OptionType;
  default: string | number | boolean;
  /** for enum/method types: the allowed values + display labels */
  choices?: { value: string; label: string }[];
  /** which pipeline stage this affects (for grouping in the UI) */
  stage: "ocr" | "vision" | "llm" | "plan" | "html" | "output" | "general";
  /** only meaningful when these other option values hold (greyed out otherwise) */
  dependsOn?: Record<string, string | number | boolean>;
  /** true if the option exists but has no real effect today (e.g. --parser) */
  inert?: boolean;
  /** tooltip / help text (reused from the CLI help strings) */
  help: string;
}

/** The default OpenRouter model used for LLM enrichment and the vision pass. */
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview";

export const optionsSchema: OptionSpec[] = [
  {
    key: "ocrMethod",
    cliFlag: "--ocr",
    label: "OCR method",
    type: "method",
    default: "gpt",
    choices: [
      { value: "gpt", label: "GPT (OpenRouter vision)" },
      { value: "mistral", label: "Mistral OCR" },
      { value: "unpdf", label: "unpdf (local, no API)" },
    ],
    stage: "ocr",
    help: "How the PDF text is read. 'gpt' renders each page and sends it to an OpenRouter vision model; 'mistral' uses the Mistral OCR API; 'unpdf' extracts the PDF text layer locally (no API, may surface hidden text). Any OpenRouter model name also works.",
  },
  {
    key: "model",
    cliFlag: "--model",
    label: "LLM model",
    type: "model",
    default: DEFAULT_MODEL,
    stage: "llm",
    help: "OpenRouter model used for the LLM enrichment stage (language tagging + metadata).",
  },
  {
    key: "visionFormatting",
    cliFlag: "--vision-formatting",
    label: "Vision formatting",
    type: "boolean",
    default: true,
    stage: "vision",
    help: "Use a vision model to detect per-page text alignment; background color is detected deterministically. On by default.",
  },
  {
    key: "visionModel",
    cliFlag: "--vision-model",
    label: "Vision-formatting model",
    type: "model",
    default: DEFAULT_MODEL,
    stage: "vision",
    dependsOn: { visionFormatting: true },
    help: "OpenRouter model for the vision-formatting pass. Independent of the LLM model.",
  },
  {
    key: "coverMode",
    cliFlag: "--cover",
    label: "Cover handling",
    type: "enum",
    default: "auto",
    choices: [
      { value: "auto", label: "Auto-detect full-bleed" },
      { value: "render", label: "Always render (first + last)" },
      { value: "none", label: "Leave to Bloom xMatter" },
    ],
    stage: "ocr",
    help: "Full-page cover handling: 'auto' renders a cover image only when the page is detected as full-bleed art; 'render' always renders the first and last pages; 'none' leaves covers to Bloom's xMatter.",
  },
  {
    key: "complexBecomesImage",
    cliFlag: "--complex-becomes-image",
    label: "Complex page → flatten as image",
    type: "enum",
    default: "off",
    choices: [
      { value: "off", label: "Only full cover images" },
      { value: "0", label: "Every canvas page" },
      { value: "1", label: "Unless super safe" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4", label: "4" },
      { value: "5", label: "Brave - only most complex" },
      { value: "always", label: "Always — every page as an image" },
    ],
    stage: "html",
    help: "When a page is too complex to rebuild as editable HTML, import it as a single full-page image instead. Lower numbers flatten more readily; 0 flattens every canvas page; off never does. 'always' imports EVERY page as a full-page image (only a few pages are OCR'd for metadata/languages; no per-page layout analysis runs).",
  },
  {
    key: "target",
    cliFlag: "--target",
    label: "Target output",
    type: "enum",
    default: "bloom",
    choices: [
      { value: "images", label: "Images (extract only)" },
      { value: "ocr", label: "OCR markdown" },
      { value: "tagged", label: "Tagged markdown" },
      { value: "bloom", label: "Bloom HTML" },
    ],
    stage: "output",
    help: "Which artifact to stop at: extract images only, OCR markdown, tagged markdown (through the LLM + plan), or the final Bloom HTML.",
  },
  {
    key: "prompt",
    cliFlag: "--prompt",
    label: "Custom prompt file",
    type: "path",
    default: "",
    stage: "general",
    help: "Path to a custom prompt file overriding the built-in OCR/enrichment prompt.",
  },
  {
    key: "imager",
    cliFlag: "--imager",
    label: "Image extraction",
    type: "enum",
    default: "poppler",
    choices: [{ value: "poppler", label: "Poppler (pdfimages)" }],
    stage: "ocr",
    help: "Image extraction method. Only 'poppler' is implemented.",
  },
  {
    key: "parserEngine",
    cliFlag: "--parser",
    label: "PDF parser engine",
    type: "enum",
    default: "native",
    choices: [
      { value: "native", label: "Native" },
      { value: "mistral-ocr", label: "Mistral OCR" },
      { value: "pdf-text", label: "PDF text" },
    ],
    stage: "ocr",
    inert: true,
    help: "Only affects the unused OpenRouter file-parser path; the live GPT OCR path ignores it.",
  },
  {
    key: "emitSourceHashes",
    cliFlag: "--emit-source-hashes",
    label: "Emit source hashes (build a master)",
    type: "boolean",
    default: false,
    stage: "general",
    help: "Master-creation mode: tag every page with its source render hash and skip master substitution. Use once to build a '*master' book.",
  },
  {
    key: "verbose",
    cliFlag: "--verbose",
    label: "Verbose logging",
    type: "boolean",
    default: false,
    stage: "general",
    help: "Emit detailed (verbose) log messages.",
  },
];

/** The default value for every option, keyed by `key`. */
export const defaultParams: Record<string, string | number | boolean> = Object.fromEntries(
  optionsSchema.map((o) => [o.key, o.default]),
);
