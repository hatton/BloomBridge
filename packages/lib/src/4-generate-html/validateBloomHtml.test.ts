import { describe, it, expect } from "vite-plus/test";
import { validateBloomHtml } from "./validateBloomHtml";
import { HtmlGenerator } from "./html-generator";

describe("validateBloomHtml", () => {
  it("passes a well-formed content page", () => {
    const html = `<div class="bloom-page numberedPage customPage A4Portrait" id="abc">
      <div class="marginBox">
        <div class="bloom-translationGroup">
          <div class="bloom-editable normal-style" lang="en"><p>Hi</p></div>
        </div>
      </div>
    </div>`;
    expect(validateBloomHtml(html)).toHaveLength(0);
  });

  it("flags the malformed page from the bug report (missing numberedPage)", () => {
    // This is the structure we used to emit: a bare customPage with no
    // numberedPage class — so Bloom never adds side-left/side-right and the text
    // renders hard against the page edge.
    const html = `<div class="bloom-page customPage A4Portrait" id="8a229992">
      <div class="marginBox">
        <div class="split-pane-component-inner">
          <div class="bloom-translationGroup">
            <div class="bloom-editable normal-style" lang="en"><p>You're reading Level 4</p></div>
          </div>
        </div>
      </div>
    </div>`;
    const errors = validateBloomHtml(html);
    expect(errors.some((e) => e.type === "error" && e.message.includes("numberedPage"))).toBe(true);
  });

  it("reports a missing id as an error", () => {
    const html = `<div class="bloom-page numberedPage customPage A4Portrait">
      <div class="marginBox"><div class="bloom-translationGroup"></div></div>
    </div>`;
    const errors = validateBloomHtml(html);
    expect(errors.some((e) => e.type === "error" && e.message.includes("id"))).toBe(true);
  });

  it("skips cover / xMatter pages and master-page placeholders", () => {
    const cover = `<div class="bloom-page cover coverColor bloom-frontMatter bloom-customLayout A4Portrait" id="c1">
      <div class="marginBox"><img src="cover.jpg" /></div>
    </div>`;
    const placeholder = `<div class="bloom-page customPage A4Portrait" id="m1" data-import-source-hash="abcd">
      <div class="marginBox"></div>
    </div>`;
    expect(validateBloomHtml(cover)).toHaveLength(0);
    expect(validateBloomHtml(placeholder)).toHaveLength(0);
  });

  it("generated content pages are well-formed", () => {
    const book = {
      frontMatterMetadata: { languages: { en: "English" }, l1: "en", pageSize: "A4Portrait" },
      pages: [
        {
          type: "content" as const,
          appearsToBeBilingualPage: false,
          elements: [{ type: "text" as const, content: { en: "<p>Hello</p>" } }],
        },
        {
          type: "content" as const,
          appearsToBeBilingualPage: false,
          elements: [
            { type: "image" as const, src: "pic.png" },
            { type: "text" as const, content: { en: "<p>Caption</p>" } },
          ],
        },
      ],
    };
    const html = HtmlGenerator.generateHtmlDocument(book);
    expect(validateBloomHtml(html)).toHaveLength(0);
    // Both content pages carry numberedPage (the load-bearing class) and nothing
    // we don't need.
    expect(html).toContain('class="bloom-page numberedPage customPage A4Portrait"');
    expect(html).not.toContain("data-pagelineage");
    expect(html).not.toContain("pageLabel");
  });
});
