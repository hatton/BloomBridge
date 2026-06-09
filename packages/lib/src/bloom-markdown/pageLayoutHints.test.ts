import { describe, it, expect } from "vite-plus/test";
import { BloomMarkdown } from "./parseMarkdown";
import { getMarkdownFromBook } from "./generateMarkdown";

const FRONTMATTER = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: en
---
`;

describe("page layout hints (vision-formatting attributes)", () => {
  it("parses vertical-align, horizontal-align, and background-color from the page comment", () => {
    const md = `${FRONTMATTER}<!-- page index=1 type="content" vertical-align="center" horizontal-align="left" background-color="#fff3e0" -->
<!-- text lang="en" -->
Hello`;
    const book = new BloomMarkdown().parseMarkdown(md);

    expect(book.pages[0].verticalAlign).toBe("center");
    expect(book.pages[0].horizontalAlign).toBe("left");
    expect(book.pages[0].backgroundColor).toBe("#fff3e0");
  });

  it("ignores unknown alignment values", () => {
    const md = `${FRONTMATTER}<!-- page index=1 vertical-align="middle" horizontal-align="justify" -->
<!-- text lang="en" -->
Hello`;
    const book = new BloomMarkdown().parseMarkdown(md);

    expect(book.pages[0].verticalAlign).toBeUndefined();
    expect(book.pages[0].horizontalAlign).toBeUndefined();
  });

  it("leaves the fields undefined when no hints are present", () => {
    const md = `${FRONTMATTER}<!-- page index=1 type="content" -->
<!-- text lang="en" -->
Hello`;
    const book = new BloomMarkdown().parseMarkdown(md);

    expect(book.pages[0].verticalAlign).toBeUndefined();
    expect(book.pages[0].horizontalAlign).toBeUndefined();
    expect(book.pages[0].backgroundColor).toBeUndefined();
  });

  it("keeps page attributes aligned when a <!-- book --> comment precedes the pages", () => {
    // Regression: a leading book comment made the pre-first-page segment non-empty,
    // which shifted every page's attributes onto the wrong page.
    const md = `${FRONTMATTER}<!-- book normal-font-size="28" -->

<!-- page index=1 type="content" background-color="#111111" -->
<!-- text lang="en" -->
First page text

<!-- page index=2 type="content" background-color="#222222" -->
<!-- text lang="en" -->
Second page text`;
    const book = new BloomMarkdown().parseMarkdown(md);

    expect(book.frontMatterMetadata.normalFontSizePt).toBe(28);
    expect(book.pages).toHaveLength(2);
    expect(book.pages[0].backgroundColor).toBe("#111111");
    expect((book.pages[0].elements[0] as any).content.en).toBe("First page text");
    expect(book.pages[1].backgroundColor).toBe("#222222");
    expect((book.pages[1].elements[0] as any).content.en).toBe("Second page text");
  });

  it("survives the parse -> serialize -> parse round-trip", () => {
    const md = `${FRONTMATTER}<!-- page index=1 type="content" vertical-align="bottom" horizontal-align="center" background-color="#222222" -->
<!-- text lang="en" -->
Hello`;
    const parser = new BloomMarkdown();
    const book1 = parser.parseMarkdown(md);

    const serialized = getMarkdownFromBook(book1);
    expect(serialized).toContain('vertical-align="bottom"');
    expect(serialized).toContain('horizontal-align="center"');
    expect(serialized).toContain('background-color="#222222"');

    const book2 = new BloomMarkdown().parseMarkdown(serialized);
    expect(book2.pages[0].verticalAlign).toBe("bottom");
    expect(book2.pages[0].horizontalAlign).toBe("center");
    expect(book2.pages[0].backgroundColor).toBe("#222222");
  });

  it("parses and round-trips canvas-background-image", () => {
    // The detected full-page background of a Canvas page must survive the LLM stage
    // and the parse->serialize->parse round-trips, or the picture is dropped when the
    // OCR didn't also emit an `![image]` ref (the LFA comprehension-questions page).
    const md = `${FRONTMATTER}<!-- page index=1 type="content" canvas-text-boxes="0.1,0.1,0.8,0.2" canvas-background-image="image-6-1.png" -->
<!-- text lang="en" -->
You can use these questions`;
    const book1 = new BloomMarkdown().parseMarkdown(md);
    expect(book1.pages[0].canvasBackgroundImage).toBe("image-6-1.png");

    const serialized = getMarkdownFromBook(book1);
    expect(serialized).toContain('canvas-background-image="image-6-1.png"');

    const book2 = new BloomMarkdown().parseMarkdown(serialized);
    expect(book2.pages[0].canvasBackgroundImage).toBe("image-6-1.png");
  });

  it("parses and round-trips canvas-image-boxes (positioned foreground icons)", () => {
    const md = `${FRONTMATTER}<!-- page index=1 type="content" canvas-text-boxes="0.05,0.03,0.9,0.13;0.28,0.2,0.65,0.14" canvas-image-boxes="0.07,0.21,0.16,0.12" -->
![i-1](i-1.jpg)
<!-- text lang="en" -->
You can use these questions
<!-- text lang="en" -->
Where were they going?`;
    const book1 = new BloomMarkdown().parseMarkdown(md);
    expect(book1.pages[0].canvasImageBoxes).toEqual([{ x: 0.07, y: 0.21, w: 0.16, h: 0.12 }]);

    const serialized = getMarkdownFromBook(book1);
    expect(serialized).toContain('canvas-image-boxes="0.07,0.21,0.16,0.12"');

    const book2 = new BloomMarkdown().parseMarkdown(serialized);
    expect(book2.pages[0].canvasImageBoxes).toEqual([{ x: 0.07, y: 0.21, w: 0.16, h: 0.12 }]);
  });

  it("parses and round-trips a text block's named style (tableRows)", () => {
    const md = `${FRONTMATTER}<!-- page index=1 type="content" -->
<!-- text lang="en" -->
A heading
<!-- text lang="en" style="tableRows" -->
A question?`;
    const book1 = new BloomMarkdown().parseMarkdown(md);
    const blocks1 = book1.pages[0].elements.filter((e) => e.type === "text");
    expect(blocks1[0].style).toBeUndefined();
    expect(blocks1[1].style).toBe("tableRows");

    const serialized = getMarkdownFromBook(book1);
    expect(serialized).toContain('<!-- text lang="en" style="tableRows" -->');

    const book2 = new BloomMarkdown().parseMarkdown(serialized);
    const blocks2 = book2.pages[0].elements.filter((e) => e.type === "text");
    expect(blocks2[1].style).toBe("tableRows");
    // A style change starts a fresh block (not merged with the unstyled heading).
    expect(blocks2).toHaveLength(2);
  });
});
