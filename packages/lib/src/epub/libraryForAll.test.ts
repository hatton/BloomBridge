import { describe, it, expect } from "vite-plus/test";
import { isLibraryForAllEpub, analyzeLibraryForAll } from "./libraryForAll";

// A trimmed LFA OPF metadata block, matching the real "Vanuatu" template books.
const LFA_OPF = `<?xml version="1.0"?>
<package><metadata>
  <dc:title id="pub-title">Daisy's New Friends</dc:title>
  <dc:creator>Vivene Mawa</dc:creator>
  <dc:description>Daisy and Luke are off to the playground for Children&#8217;s Day, where Daisy meets Luke&#8217;s friends. They&#8217;re all different, but they&#8217;re excited to play together!</dc:description>
  <dc:publisher>Library For All</dc:publisher>
</metadata></package>`;

describe("libraryForAll", () => {
  it("detects a Library For All EPUB by its OPF publisher", () => {
    expect(isLibraryForAllEpub(LFA_OPF)).toBe(true);
  });

  it("does not match other publishers", () => {
    expect(isLibraryForAllEpub(`<dc:publisher>Pratham Books</dc:publisher>`)).toBe(false);
    expect(isLibraryForAllEpub(`<metadata></metadata>`)).toBe(false);
  });

  it("mines the summary from the OPF description, decoding entities", () => {
    expect(analyzeLibraryForAll(LFA_OPF).summary).toBe(
      "Daisy and Luke are off to the playground for Children’s Day, where Daisy meets " +
        "Luke’s friends. They’re all different, but they’re excited to play together!",
    );
  });

  it("returns no summary when the OPF has no description", () => {
    expect(analyzeLibraryForAll(`<dc:publisher>Library For All</dc:publisher>`).summary).toBe(
      undefined,
    );
  });
});
