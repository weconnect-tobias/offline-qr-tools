"use strict";

const { defineConfig, devices } = require("@playwright/test");

// PW_CHROMIUM_PATH lets environments with a preinstalled Chromium skip `npx playwright install`.
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    acceptDownloads: true,
    // The start language follows the browser; most tests assert Swedish texts.
    // tests/e2e/language.spec.js overrides this per test.
    locale: "sv-SE",
    trace: "retain-on-failure",
    launchOptions
  },
  projects: [{ name: "chromium", use: Object.assign({}, devices["Desktop Chrome"], { launchOptions, locale: "sv-SE" }) }],
  webServer: {
    command: "node tests/support/static-server.js",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI
  }
});
