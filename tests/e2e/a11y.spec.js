"use strict";

const fs = require("node:fs");
const { test, expect, installGuards, openApp, openAllSections, enterNetwork } = require("./fixtures");

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

/* ---- Dark mode (follows the operating system, e.g. Windows "Choose your mode") ---------- */

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("no WCAG 2.1 A/AA violations in dark mode with all sections, an error and notices visible", async ({ guarded: page }) => {
    await openApp(page);
    await openAllSections(page);
    await enterNetwork(page, "Kafé", "short");
    await page.selectOption("#textStyle", "banner");
    await page.uncheck("#autoTextColor");
    await page.click("#qrColorSwatch");
    await page.waitForTimeout(400);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("the UI is dark but the QR preview stays on white paper", async ({ guarded: page }) => {
    await openApp(page);
    const colors = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      preview: getComputedStyle(document.getElementById("qrcode")).backgroundColor
    }));
    expect(colors.body).toBe("rgb(18, 20, 23)");
    expect(colors.preview).toBe("rgb(255, 255, 255)");
  });
});

test("exports and print previews are identical in light and dark mode", async ({ browser }) => {
  const results = [];
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme, locale: "sv-SE", acceptDownloads: true });
    const page = await context.newPage();
    const verify = await installGuards(page); // its own context, so the guards are added here
    await openApp(page);
    await openAllSections(page);
    await enterNetwork(page, "Kafé Åkerö", "Hemligt;lösen:1234");
    await page.selectOption("#textStyle", "plain");
    await page.fill("#titleText", "Gäst-WiFi");
    await page.waitForTimeout(500);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
    const png = fs.readFileSync(await dl.path());
    const print = await page.evaluate(() => {
      const c = document.querySelector("#printPreview canvas");
      return c ? c.toDataURL() : null;
    });
    results.push({ colorScheme, png, print });
    verify();
    await context.close();
  }
  expect(results[0].png.equals(results[1].png)).toBe(true);
  expect(results[0].print).not.toBeNull();
  expect(results[0].print).toBe(results[1].print);
});
