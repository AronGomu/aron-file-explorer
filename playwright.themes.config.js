import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  testDir: "tests/themes/visual",
  outputDir: "artifacts/theme-validation/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["json", { outputFile: "artifacts/theme-validation/visual/results.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    baseURL: "http://127.0.0.1:1422",
    viewport: { width: 1200, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:themes",
    url: "http://127.0.0.1:1422",
    cwd: repoRoot,
    reuseExistingServer: false,
  },
});
