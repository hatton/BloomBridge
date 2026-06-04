import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

// Repo root is two levels up from packages/gui (the playwright cwd).
const repoRoot = path.resolve(process.cwd(), "..", "..");
const testInputs = path.join(repoRoot, "test-inputs");

test("app loads, scans a folder, lists PDFs, and runs an images-only conversion", async ({
  page,
}) => {
  expect(fs.existsSync(testInputs), `expected test-inputs at ${testInputs}`).toBeTruthy();

  await page.goto("/");

  // 1) The app shell renders.
  await expect(page.getByText("PDF → Bloom").first()).toBeVisible();
  await expect(page.getByText("Conversion Manager").first()).toBeVisible();

  // If no OpenRouter key is configured, the Settings dialog auto-opens and blocks
  // the UI. Dismiss it (saving with the empty field doesn't overwrite any key).
  // Images-only conversion never calls the API, so we don't need a key here.
  const settingsDialog = page.getByText("Stored locally on this machine");
  if (await settingsDialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Save settings/i }).click();
    await expect(settingsDialog).toBeHidden();
  }

  // 2) Enter a real folder path and scan it.
  const folderInput = page.getByPlaceholder(/Paste a folder path/);
  await expect(folderInput).toBeVisible();
  await folderInput.fill(testInputs);
  await folderInput.press("Enter");

  // 3) The scanned PDFs appear in the table.
  await expect(page.getByText("bilingual-sample").first()).toBeVisible();

  // 4) Select the PDF → the PDF detail pane shows a prominent Run button.
  await page.getByText("bilingual-sample").first().click();
  const runBtn = page.getByRole("button", { name: /Run conversion/i });
  await expect(runBtn).toBeVisible();

  // 5) Use no collection (keeps this test independent of a running Bloom) and the
  //    images-only target (no API key needed), then launch.
  await page
    .locator('label:has-text("Bloom collection") select')
    .selectOption({ label: "No collection" });
  const targetSelect = page.locator('label:has-text("Target output") select');
  await expect(targetSelect).toBeVisible();
  await targetSelect.selectOption({ label: "Images (extract only)" });
  await runBtn.click();

  // 6) The run goes through queued/running and reaches the completed ("Awaiting
  //    Review") state — proving launch → live SSE → completion end-to-end.
  await expect(page.getByText("Awaiting Review").first()).toBeVisible({ timeout: 60_000 });

  // 7) Open the run and confirm the Artifacts tab shows the extracted images and
  //    the new "File Explorer" / "VS Code" actions.
  await page.getByText("Awaiting Review").first().click();
  await expect(page.getByRole("button", { name: "File Explorer" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "VS Code" })).toBeVisible();
  await expect(page.getByText("image-1-1.png").first()).toBeVisible();
});
