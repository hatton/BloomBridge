import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { applyMasterPages, findMasterBookFolder, loadMasterPages } from "./masterPages";

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

const GENERATED_HTML = `<!doctype html>
<html><body>
  <div class="bloom-page customPage A5Portrait" id="g1" data-import-source-hash="zzz999">
    <div class="marginBox"><p>ordinary content</p></div>
  </div>
  <div class="bloom-page customPage A5Portrait" id="g2" data-import-source-hash="abc123">
    <div class="marginBox"></div>
  </div>
</body></html>`;
