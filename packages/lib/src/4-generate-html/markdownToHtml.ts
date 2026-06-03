import escapeHtml from "escape-html";

/**
 * Convert inline markdown (bold, italic, links) within a single line of text to
 * HTML. The text is HTML-escaped first, then the inline markers are turned into
 * tags, so user content can't inject markup.
 */
export function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

/**
 * Convert a block of markdown content to Bloom-friendly HTML: markdown headings
 * (`#`..`######`) become `<h1>`..`<h6>`, and blank-line-separated runs of text
 * become separate `<p>` paragraphs. Inline formatting is applied within each.
 *
 * Bloom content text (inside `.bloom-editable`) was previously emitted by simply
 * escaping the whole string and wrapping it in one `<p>`, which showed `#`
 * literally and collapsed paragraph breaks. This produces real structure.
 */
export function blockMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      // Join soft-wrapped lines with a space (standard markdown paragraph behavior).
      blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (line === "") {
      flushParagraph();
    } else if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();

  return blocks.join("\n");
}
