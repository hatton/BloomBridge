import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  appendMasterMapping,
  applyMasterPages,
  clearMasterMapping,
  findMasterBookFolder,
  loadMasterPages,
  loadMasterPagesById,
  readMasterPageMap,
} from "./masterPages";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "master-test-"));
}

describe("master pages", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("finds a sibling folder ending in 'master', excluding the current book", async () => {
    await fs.mkdir(path.join(root, "Book One"));
    await fs.mkdir(path.join(root, "Publisher master"));
    await fs.mkdir(path.join(root, "current master")); // would match but is excluded

    const found = await findMasterBookFolder(root, path.join(root, "current master"));
    expect(found).toBe(path.join(root, "Publisher master"));
  });

  it("loads master pages keyed by source hash with their images", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML);

    const pages = await loadMasterPages(masterFolder);
    expect([...pages.keys()]).toEqual(["abc123"]);
    expect(pages.get("abc123")!.images).toEqual(["image-9-1.png"]);
  });

  it("substitutes a matched page (copying + renaming its images) and strips the marker from others", async () => {
    const masterFolder = path.join(root, "Pub master");
    const bookFolder = path.join(root, "Book One");
    await fs.mkdir(masterFolder);
    await fs.mkdir(bookFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML);
    await fs.writeFile(path.join(masterFolder, "image-9-1.png"), "PNGDATA");

    const masterPages = await loadMasterPages(masterFolder);
    const result = await applyMasterPages(GENERATED_HTML, {
      masterPages,
      bookFolder,
      masterFolder,
      emitSourceHashes: false,
    });

    // Matched page: master HTML spliced in, image rewritten to a namespaced copy.
    expect(result).toContain("THE MASTER LICENSE PAGE");
    expect(result).toContain('src="mabc123-image-9-1.png"');
    expect(result).not.toContain('src="image-9-1.png"');
    const copied = await fs.readFile(path.join(bookFolder, "mabc123-image-9-1.png"), "utf-8");
    expect(copied).toBe("PNGDATA");

    // Non-matched page: kept, but the internal marker attribute is stripped.
    expect(result).toContain("ordinary content");
    expect(result).not.toContain('data-import-source-hash="zzz999"');

    // The matched page is tagged for the Bloom-side reuse badge.
    expect(result).toContain('data-from-master="master-guid-1"');

    // The source-page link is carried onto the spliced master div, so the paired
    // preview keeps the page aligned (rather than orphaning the source page to the end).
    expect(result).toContain('data-source-pdf-page="7"');
  });

  it("loads every master page keyed by id, including pages with no embedded hash", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);

    const byId = await loadMasterPagesById(masterFolder);
    expect([...byId.keys()].sort()).toEqual(["page-credits", "page-license"]);
    expect(byId.get("page-license")!.images).toEqual(["image-9-1.png"]);
  });

  it("round-trips the mapping file and clears entries", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);

    await appendMasterMapping(masterFolder, "src-hash-1", "page-license");
    await appendMasterMapping(masterFolder, "src-hash-2", "page-license"); // many → one
    let map = await readMasterPageMap(masterFolder);
    expect(map.entries.map((e) => e.sourceHash).sort()).toEqual(["src-hash-1", "src-hash-2"]);

    // Re-recording the same source hash replaces, not duplicates.
    await appendMasterMapping(masterFolder, "src-hash-1", "page-credits");
    map = await readMasterPageMap(masterFolder);
    expect(map.entries.filter((e) => e.sourceHash === "src-hash-1")).toHaveLength(1);
    expect(map.entries.find((e) => e.sourceHash === "src-hash-1")!.masterPageId).toBe(
      "page-credits",
    );

    await clearMasterMapping(masterFolder, "src-hash-1");
    map = await readMasterPageMap(masterFolder);
    expect(map.entries.map((e) => e.sourceHash)).toEqual(["src-hash-2"]);
  });

  it("loadMasterPages resolves mapping-file entries by master page id", async () => {
    const masterFolder = path.join(root, "Pub master");
    await fs.mkdir(masterFolder);
    await fs.writeFile(path.join(masterFolder, "Pub master.htm"), MASTER_HTML_MULTI);
    await appendMasterMapping(masterFolder, "src-hash-1", "page-license");

    const pages = await loadMasterPages(masterFolder);
    expect(pages.has("src-hash-1")).toBe(true);
    expect(pages.get("src-hash-1")!.id).toBe("page-license");
  });
});

const MASTER_HTML = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="master-guid-1" data-import-source-hash="abc123">
    <div class="marginBox">
      <p>THE MASTER LICENSE PAGE</p>
      <img src="image-9-1.png" />
    </div>
  </div>
</body></html>`;

// Two pages with stable ids but NO embedded source hash — designated purely via the
// mapping file (the new GUI-driven workflow).
const MASTER_HTML_MULTI = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="page-license">
    <div class="marginBox"><p>LICENSE</p><img src="image-9-1.png" /></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="page-credits">
    <div class="marginBox"><p>CREDITS</p></div>
  </div>
</body></html>`;

const GENERATED_HTML = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="g1" data-import-source-hash="zzz999">
    <div class="marginBox"><p>ordinary content</p></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="g2" data-import-source-hash="abc123" data-source-pdf-page="7">
    <div class="marginBox"></div>
  </div>
</body></html>`;
