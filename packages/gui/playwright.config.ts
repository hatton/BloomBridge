import { defineConfig, devices } from "@playwright/test";

// Assumes the dev server (which also serves the API) is already running on 5180.
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5180",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
