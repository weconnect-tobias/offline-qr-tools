"use strict";

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork } = require("./fixtures");

const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function axeViolations(page) {
  await page.evaluate(AXE); // injected via the DevTools protocol, so the page CSP does not block it
  return page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

test("no WCAG 2.1 A/AA violations in the initial state", async ({ guarded: page }) => {
  await openApp(page);
  expect(await axeViolations(page)).toEqual([]);
});

test("no WCAG 2.1 A/AA violations with all sections, an error and the print preview visible", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, "Kafé", "short");
  await page.selectOption("#textStyle", "banner");
  await page.uncheck("#autoTextColor");
  await page.click("#qrColorSwatch");
  await page.waitForTimeout(400);
  expect(await axeViolations(page)).toEqual([]);
});

test("keyboard: logo picker is reachable and popovers close with Escape", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  const chooser = page.waitForEvent("filechooser");
  await page.focus("#logoFile");
  await page.keyboard.press("Space");
  await chooser;

  await page.click("#langBtn");
  await expect(page.locator("#langPopover")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#langPopover")).not.toHaveClass(/open/);
  await expect(page.locator("#langBtn")).toBeFocused();
});

test("reflows at 320 px without horizontal scrolling", async ({ guarded: page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
