import { describe, it, expect } from "vite-plus/test";
import { attemptCleanup } from "./post-llm-cleanup";

const validFrontmatter = `---
allTitles:
  en: "Book"
languages:
  en: "English"
l1: en
---`;

function wrapWithFrontmatter(body: string): string {
  return `${validFrontmatter}\n${body}`;
}

describe("attemptCleanup", () => {
  it("strips code block wrappers", () => {
    const wrapped = `\`\`\`\n${wrapWithFrontmatter('<!-- text lang="en" -->\nText')}\n\`\`\``;
    const result = attemptCleanup(wrapped);
    expect(result.valid).toBe(true);
    expect(result.cleaned).not.toContain("```");
    expect(result.cleaned.startsWith("---")).toBe(true);
  });

  it("fixes missing opening yaml delimiter", () => {
    const input = `allTitles:\n  en: Book\nlanguages:\n  en: English\nl1: en\n<!-- text lang="en" -->\nText`;
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned.startsWith("---")).toBe(true);
    expect(result.cleaned).toContain('---\n<!-- text lang="en" -->');
  });

  it("reorders language comments after images", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="en" -->\n![img](img.png){width=150}`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toMatch(/!\[img\]\(img.png\)\{width=150\}\n<!-- text lang="en" -->/);
  });

  it("removes code blocks from content", () => {
    const input = wrapWithFrontmatter(
      `<!-- text lang="en" -->\nHere is code:\n\`\`\`js\nconsole.log('hi');\n\`\`\``,
    );
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).not.toContain("```");
    expect(result.cleaned).toContain("console.log('hi');");
  });

  it("returns invalid when required fields are missing", () => {
    const bad = `---\nallTitles:\n  en: Book\n---\n<!-- text lang="en" -->\ntext`;
    const result = attemptCleanup(bad);
    expect(result.valid).toBe(false);
  });

  it("removes code block lines while preserving content", () => {
    const input = wrapWithFrontmatter(
      `<!-- text lang="en" -->\nHere is some text:\n\`\`\`bash\necho "hello"\nls -la\n\`\`\`\n\nAnd more text:\n\`\`\`\nsome plain code\nmore code\n\`\`\``,
    );
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).not.toContain("```");
    expect(result.cleaned).not.toContain("bash");
    expect(result.cleaned).toContain('echo "hello"');
    expect(result.cleaned).toContain("ls -la");
    expect(result.cleaned).toContain("some plain code");
    expect(result.cleaned).toContain("more code");
  });

  it("handles yaml code block with markdown text properly", () => {
    const input = `\`\`\`yaml
languages:
  gn: "Gondi"
  en: "English"
  l1: "gn"
  l2: "en"
\`\`\`
\`\`\`markdown
<!-- text lang="zxx" -->
\`\`\``;
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).not.toContain("```");
    expect(result.cleaned).not.toContain("yaml");
    expect(result.cleaned).not.toContain("markdown");
    expect(result.cleaned).toContain("languages:");
    expect(result.cleaned).toContain('<!-- text lang="zxx" -->');
    expect(result.cleaned.startsWith("---")).toBe(true);
  });

  it("marks page numbers in zxx language blocks at end of pages", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="en" -->
This is page content.
More text here.

<!-- text lang="zxx" -->
42

<!-- page index=2 -->

<!-- text lang="en" -->
Next page content.

<!-- text lang="zxx" -->
100`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n42');
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n100');
    expect(result.cleaned).toContain("This is page content.");
    expect(result.cleaned).toContain("Next page content.");
  });

  it("marks page numbers with dashes and dots in zxx blocks", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="en" -->
Content here.

<!-- text lang="zxx" -->
- 15 -

<!-- page index=2 -->

<!-- text lang="en" -->
More content.

<!-- text lang="zxx" -->
3.14`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n- 15 -');
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n3.14');
    expect(result.cleaned).toContain("Content here.");
    expect(result.cleaned).toContain("More content.");
  });

  it("preserves numbers in other language blocks", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="en" -->
There are 42 students in the class.
The temperature is 25°C.
Chapter 3: Advanced Topics

<!-- text lang="en" -->
More content with numbers: 123, 456`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain("There are 42 students in the class.");
    expect(result.cleaned).toContain("The temperature is 25°C.");
    expect(result.cleaned).toContain("Chapter 3: Advanced Topics");
    expect(result.cleaned).toContain("More content with numbers: 123, 456");
  });

  it("preserves zxx blocks that contain non-numeric content", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="zxx" -->
Some special symbols: ♪ ♫ ♬

<!-- text lang="en" -->
Regular content.

<!-- text lang="zxx" -->
Mixed content 42 with text`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain("Some special symbols: ♪ ♫ ♬");
    expect(result.cleaned).toContain("Mixed content 42 with text");
    expect(result.cleaned).toContain("Regular content.");
  });

  it("marks Unicode digits from various scripts in zxx blocks", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="hi" -->
हिंदी में सामग्री।

<!-- text lang="zxx" -->
२५

<!-- page index=2 -->

<!-- text lang="ar" -->
محتوى عربي.

<!-- text lang="zxx" -->
٤٢`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n२५');
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n٤٢');
    expect(result.cleaned).toContain("हिंदी में सामग्री।");
    expect(result.cleaned).toContain("محتوى عربي.");
  });

  it("only marks the last zxx number block on each page", () => {
    const input = wrapWithFrontmatter(`<!-- text lang="en" -->
Learning about numbers:

<!-- text lang="zxx" -->
1

<!-- text lang="zxx" -->
2

<!-- text lang="zxx" -->
3

<!-- text lang="zxx" -->
42`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    // Should keep the educational numbers unchanged but mark the page number at the end
    expect(result.cleaned).toContain('<!-- text lang="zxx" -->\n1');
    expect(result.cleaned).toContain('<!-- text lang="zxx" -->\n2');
    expect(result.cleaned).toContain('<!-- text lang="zxx" -->\n3');
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n42');
  });

  it("marks page numbers followed by images", () => {
    const input = wrapWithFrontmatter(`<!-- page index="6" -->

<!-- text lang="zxx" -->
4

![image](image-6-1.png)

<!-- page index="7" -->

<!-- text lang="en" -->
Next page content.

<!-- text lang="zxx" -->
5

![another-image](image-7-1.png)`);
    const result = attemptCleanup(input);
    expect(result.valid).toBe(true);
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n4');
    expect(result.cleaned).toContain('<!-- text lang="zxx" field="pageNumber" -->\n5');
    expect(result.cleaned).toContain("![image](image-6-1.png)");
    expect(result.cleaned).toContain("![another-image](image-7-1.png)");
    expect(result.cleaned).toContain("Next page content.");
  });
});
