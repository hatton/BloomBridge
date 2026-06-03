import escapeHtml from "escape-html";
import { logger } from "../logger.js";
import { blockMarkdownToHtml } from "./markdownToHtml.js";

export enum Orientation {
  Portrait = "portrait",
  Landscape = "landscape",
}

export interface TextOrigamiItem {
  type: "text";
  content: Record<string, string>;
  translationGroupDefaultLangVariables?: ("*" | "auto" | "V" | "L1" | "N1")[];
  /** Vertical position of the text within the page (Bloom translationGroup class). */
  verticalAlign?: "top" | "center" | "bottom";
  /** Horizontal alignment of the text (applied as text-align on the editables). */
  horizontalAlign?: "left" | "center" | "right";
}

export interface ImageOrigamiItem {
  type: "image";
  src: string;
  /**
   * Optional inline style for the bloom-canvas-element (width/height/top/left in px),
   * precomputed from the page size so the image shows at the right size before Bloom
   * recomputes it on first view. Omitted for images in multi-pane layouts.
   */
  canvasElementStyle?: string;
}

export type OrigamiItem = TextOrigamiItem | ImageOrigamiItem;

/**
 * Generates Bloom HTML for a given sequence of items and orientation.
 * @returns The generated HTML string.
 * @throws Error if the input sequence is empty.
 */
export function generateOrigamiHtml(
  blocks: OrigamiItem[],
  orientation: Orientation = Orientation.Portrait,
): string {
  if (!blocks || blocks.length === 0) {
    throw new Error("Input sequence cannot be empty.");
  }

  if (blocks.length === 1) {
    // Single item: just the inner component with the actual content.
    const item = blocks[0];
    return `
<div class="split-pane-component-inner">
  ${generateItemHtml(item)}
</div>`.trim();
  }
  // Multiple items: start with a split pane structure.
  return buildSplitPane(blocks, orientation);
}

/**
 * Recursively builds the HTML for a split pane structure.
 * @returns HTML string for the split pane.
 */
function buildSplitPane(
  blocks: OrigamiItem[],
  orientation: Orientation = Orientation.Portrait,
): string {
  const firstItem = blocks[0];
  const remainingItemsSequence = blocks.slice(1);

  // Content for the first pane is the HTML for the first item.
  const contentForFirstPane = generateItemHtml(firstItem);

  let contentForSecondPane: string;
  if (remainingItemsSequence.length === 1) {
    // If only one item remains, it's the content for the second pane.
    const secondItem = remainingItemsSequence[0];
    contentForSecondPane = generateItemHtml(secondItem);
  } else {
    // If multiple items remain, the second pane contains another nested split.
    contentForSecondPane = buildSplitPane(remainingItemsSequence, orientation);
  }

  // the labels we have to emit are the opposite of actual orientation
  // they refer to the orientation of the split, not the orientation of the content
  const splitOrientation = orientation === Orientation.Landscape ? "vertical" : "horizontal";

  // Determine CSS classes based on orientation
  const splitPaneClass = `split-pane ${splitOrientation}-percent`;
  const firstPositionClass = `split-pane-component position-${
    splitOrientation === "horizontal" ? "top" : "left"
  }`;
  const dividerClass = `split-pane-divider ${splitOrientation}-divider`;
  const secondPositionClass = `split-pane-component position-${
    splitOrientation === "horizontal" ? "bottom" : "right"
  }`;

  return `
<div class="${splitPaneClass}">
  <div class="${firstPositionClass}">
    <div class="split-pane-component-inner">
      ${contentForFirstPane}
    </div>
  </div>
  <div class="${dividerClass}"></div>
  <div class="${secondPositionClass}">
    <div class="split-pane-component-inner">
      ${contentForSecondPane}
    </div>
  </div>
</div>`.trim();
}

/**
 * Generates the HTML for a single text block.
 * This function is intended for internal use by the origami generator.
 * @param textBlocks A record of language codes to HTML content strings.
 * @param translationGroupDefaultLangVariables Optional array of default language variables (e.g., "V", "N1").
 * @returns HTML string for the text block.
 */
function generateTextBlock(
  textBlocks: Record<string, string>,
  translationGroupDefaultLangVariables?: string[],
  verticalAlign?: "top" | "center" | "bottom",
  horizontalAlign?: "left" | "center" | "right",
): string {
  logger.verbose(`Generating text block with languages: ${JSON.stringify(textBlocks, null, 2)}`);

  const bloomEditableDivs: string[] = [];

  // Horizontal alignment is applied as a text-align style on each editable;
  // CSS inheritance carries it down to the paragraphs inside.
  const editableStyleAttr =
    horizontalAlign && horizontalAlign !== "left" ? ` style="text-align: ${horizontalAlign};"` : "";

  // iterate over the languages and create a bloom-editable div for each
  for (const lang of Object.keys(textBlocks)) {
    const content = textBlocks[lang];

    // Convert markdown content (headings, paragraphs, inline styles) to HTML.
    // An empty editable still needs a paragraph so Bloom has something to edit.
    const html = blockMarkdownToHtml(content) || "<p></p>";

    bloomEditableDivs.push(
      `
<div class="bloom-editable normal-style" lang="${lang}"${editableStyleAttr}>
  ${html}
</div>`.trim(),
    );
  }

  const defLangsAttr = translationGroupDefaultLangVariables
    ? ` data-default-languages="${translationGroupDefaultLangVariables.join(",")}"`
    : "";

  // Vertical positioning of the text within the page uses Bloom's
  // bloom-vertical-align-* classes on the translationGroup.
  const groupClasses = ["bloom-translationGroup"];
  if (verticalAlign) {
    groupClasses.push(`bloom-vertical-align-${verticalAlign}`);
  }

  return `
<div class="${groupClasses.join(" ")}"${defLangsAttr}>
  ${bloomEditableDivs.join("\n")}
</div>`.trim();
}

/**
 * Generates the HTML for a single image block.
 * This function is intended for internal use by the origami generator.
 * @param src The source URL of the image.
 * @returns HTML string for the image block.
 */
function generateImageBlock(src: string | undefined, canvasElementStyle?: string): string {
  const styleAttr = canvasElementStyle ? ` style="${canvasElementStyle}"` : "";
  return `
<div class="bloom-canvas bloom-leadingElement bloom-has-canvas-element">
  <div class="bloom-canvas-element bloom-backgroundImage"${styleAttr}>
    <div class="bloom-leadingElement bloom-imageContainer">
      <img src="${escapeHtml(src || "")}" />
    </div>
  </div>
</div>`.trim();
}

/**
 * Generates the HTML content for a given OrigamiItem.
 * @param item The OrigamiItem to render.
 * @returns HTML string for the item's content.
 */
function generateItemHtml(item: OrigamiItem): string {
  if (item.type === "text") {
    return generateTextBlock(
      item.content,
      item.translationGroupDefaultLangVariables,
      item.verticalAlign,
      item.horizontalAlign,
    );
  } else if (item.type === "image") {
    return generateImageBlock(item.src, item.canvasElementStyle);
  }
  // Should not happen with proper typing
  return "<!-- unknown item type !-->";
}
