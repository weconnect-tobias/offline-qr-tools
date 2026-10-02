"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect, ROOT, openApp, enterNetwork } = require("./fixtures");

// Users may simply double-click index.html. Everything must work from file:// as well.
test("works when opened directly from disk (file://)", async ({ guarded: page }) => {
  await openApp(page, pathToFileURL(path.join(ROOT, "index.html")).href);
  await enterNetwork(page, "Kafé Åkerö", "Hemligt;lösen:1234");
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#download")).toBeEnabled();
});

// The bundled Swish symbol must not taint the canvas on file:// (exports would fail).
test("the bundled Swish symbol works from disk and the export still decodes", async ({ guarded: page }) => {
  const { openAllSections, waitForScan, download, decodePng } = require("./fixtures");
  await openApp(page, pathToFileURL(path.join(ROOT, "index.html")).href + "#swish");
  await openAllSections(page);
  await page.fill("#swNumber", "1231234567");
  await page.click("[data-swish-look=standard]");
  await expect(page.locator("#logoPreview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  await page.selectOption("#exportFormat", "png");
  const png = await download(page, () => page.click("#download"));
  expect(await decodePng(page, png.data)).toContain("sw=1231234567");
});
