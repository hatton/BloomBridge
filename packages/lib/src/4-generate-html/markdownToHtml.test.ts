import { describe, it, expect } from "vite-plus/test";
import { blockMarkdownToHtml, inlineMarkdownToHtml } from "./markdownToHtml";

describe("blockMarkdownToHtml", () => {
  it("turns a heading and following paragraph into <h1> and <p>", () => {
    const md = "# About the author\n\nVanessa David Nimbwen was born in Port Vila.";
    expect(blockMarkdownToHtml(md)).toBe(
      "<h1>About the author</h1>\n<p>Vanessa David Nimbwen was born in Port Vila.</p>",
    );
  });

  it("splits blank-line-separated text into separate paragraphs", () => {
    const md = "First paragraph.\n\nSecond paragraph.";
    expect(blockMarkdownToHtml(md)).toBe("<p>First paragraph.</p>\n<p>Second paragraph.</p>");
  });

  it("supports heading levels h1-h6", () => {
    expect(blockMarkdownToHtml("### Sub")).toBe("<h3>Sub</h3>");
    expect(blockMarkdownToHtml("###### Deep")).toBe("<h6>Deep</h6>");
  });

  it("joins soft-wrapped lines within a paragraph", () => {
    expect(blockMarkdownToHtml("one\ntwo")).toBe("<p>one two</p>");
  });

  it("escapes HTML in content", () => {
    expect(blockMarkdownToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("does not treat '#' without a space as a heading", () => {
    expect(blockMarkdownToHtml("#notaheading")).toBe("<p>#notaheading</p>");
  });
});

describe("inlineMarkdownToHtml", () => {
  it("applies bold, italic, and links and escapes text", () => {
    expect(inlineMarkdownToHtml("**bold** and *italic*")).toBe(
      "<strong>bold</strong> and <em>italic</em>",
    );
    expect(inlineMarkdownToHtml("[Bloom](https://bloomlibrary.org)")).toBe(
      '<a href="https://bloomlibrary.org">Bloom</a>',
    );
  });
});
