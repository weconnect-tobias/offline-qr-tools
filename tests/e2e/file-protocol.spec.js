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
