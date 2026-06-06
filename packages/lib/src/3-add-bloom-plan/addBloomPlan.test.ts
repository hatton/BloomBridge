import { describe, it, expect } from "vite-plus/test";
import { BloomMarkdown } from "../bloom-markdown/parseMarkdown";
import { addBloomPlanToMarkdown } from "./addBloomPlan";
import { normalizeMarkdown } from "../test-utils";

describe("3-process-tagged-markdown", () => {
  it("first few pages smoke test", () => {
    const llmInput = `---
allTitles:
  fr: "La lune et la casquette"
  en: "The Moon and the Cap"
languages:
  fr: "française"
  en: "English"
l1: "fr"
l2: "en"
coverImage: "img-0.jpeg"
license: "CC-BY-4.0"
copyright: "Copyright (c) 2007, Pratham Books"
credits:
  author: "Noni"
  illustrator: "Angie & Upesh"
tags:
  topic: "Folktale"
publisher: "Pratham Books"
country: "France"
---
<!-- page index=1 -->
<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
The Moon and the Cap

<!-- text lang="en" field="coverImage" -->
![img-0.jpeg](img-0.jpeg){width=993}

<!-- text lang="fr" field="author" -->
Auteur: Noni

<!-- text lang="fr" field="illustrator" -->
Illustration : Angie & Upesh

<!-- text lang="fr" field="tags" -->
française
Livre de récits

<!-- page index=2 -->
.

<!-- page index=3 -->
<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
## The Moon and the Cap

<!-- text lang="en" field="credits" -->
Written by Noni Illustrations by Angie and Upesh

<!-- text lang="en" field="funding-info" -->
Funded the Corporation for Nationl Broadcasting

<!-- text lang="fr" field="tags" -->
française

<!-- text lang="fr" field="country" -->
France`;
    const expectedOutput = `
---
allTitles:
  fr: "La lune et la casquette"
  en: "The Moon and the Cap"
languages:
  fr: "française"
  en: "English"
l1: "fr"
l2: "en"
coverImage: "img-0.jpeg"
license: "CC-BY-4.0"
copyright: "Copyright (c) 2007, Pratham Books"
credits:
  author: "Noni"
  illustrator: "Angie & Upesh"
tags:
  topic: "Folktale"
publisher: "Pratham Books"
country: "France"
---

<!-- page index=1 bilingual="true" type="front-matter" -->

<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
The Moon and the Cap

<!-- text lang="en" field="coverImage" -->

![img-0.jpeg](img-0.jpeg){width=993}

<!-- text lang="fr" field="author" -->
Auteur: Noni

<!-- text lang="fr" field="illustrator" -->
Illustration : Angie & Upesh

<!-- text lang="fr" field="tags" -->
française
Livre de récits

<!-- page index=2 type="front-matter" -->

<!-- text lang="unk" -->
.

<!-- page index=3 bilingual="true" type="front-matter" -->

<!-- text lang="fr" field="title" -->
# La lune et la casquette 

<!-- text lang="en" field="title" -->
## The Moon and the Cap

<!-- text lang="en" field="credits" -->
Written by Noni Illustrations by Angie and Upesh

<!-- text lang="en" field="funding-info" -->
Funded the Corporation for Nationl Broadcasting

<!-- text lang="fr" field="tags" -->
française

<!-- text lang="fr" field="country" -->
France
`;
    const result = addBloomPlanToMarkdown(llmInput);

    // Use semantic comparison instead of exact string matching
    expect(normalizeMarkdown(result)).toBe(normalizeMarkdown(expectedOutput));
  });

  it("should mark pages as bilingual when both languages are present in the same block", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
  es: "Español"
l1: en
l2: es
---
<!-- page -->
<!-- text lang="en" -->
First page without attributes
<!-- text lang="es" -->
First page Spanish
<!-- page -->
<!-- text lang="en" -->
Second page without attributes`;

    const result = addBloomPlanToMarkdown(content);
    const book = new BloomMarkdown().parseMarkdown(result);

    expect(book.pages[0].appearsToBeBilingualPage).toBe(true);
    expect(!!book.pages[1].appearsToBeBilingualPage).toBe(false);
  });

  it("should filter out page number fields", () => {
    const content = `---
allTitles:
  en: "Test Book"
languages:
  en: "English"
l1: "en"
---
<!-- page index=1 -->

<!-- text lang="en" -->
Content on page one.

<!-- text lang="zxx" field="pageNumber" -->
1

<!-- page index=2 -->

<!-- text lang="en" -->
Content on page two.

<!-- text lang="zxx" field="pageNumber" -->
2`;

    const result = addBloomPlanToMarkdown(content);

    // Page number fields should be filtered out of the result
    expect(result).toContain("Content on page one.");
    expect(result).toContain("Content on page two.");
    expect(result).not.toContain('field="pageNumber"');
    expect(result).not.toContain('<!-- text lang="zxx" field="pageNumber" -->');
  });
});
