"use strict";

// Regression tests for bugs found in the code review of version 1.1.0. Each test names the
// behaviour that was broken, so a failure points straight at what came back.

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork, waitForScan, decodePng, pdfSearchableText, download } = require("./fixtures");

// FICTIONAL TEST DATA - not a real network or password.
const SSID = "Kafé Åkerö";
const PASSWORD = "Hemligt;lösen:1234";

// Makes a solid PNG of the given size inside the page and returns its bytes as base64.
async function pngBase64(page, w, h, color) {
  return page.evaluate(async ([w, h, color]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h, color]);
}

async function chooseType(page, type) {
  await page.click(`input[name=qrType][value=${type}]`, { force: true });
}

test("a logo on a very short payload still scans: the code is at least version 3", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await chooseType(page, "text");
  await page.fill("#qrText", "x");
  await waitForScan(page);
  const b64 = await pngBase64(page, 120, 120, "#e11d48");
  await page.evaluate((b) => loadLogoBuffer(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer), b64);
  await expect(page.locator("#logoPreview img")).toHaveCount(1);
  await waitForScan(page);

  const result = await page.evaluate(() => {
    const bad = [];
    for (const background of LOGO_BACKGROUNDS) {
      for (const size of [10, 20, 25, 30]) {
        const opts = Object.assign(getRenderOpts(), { logoBackground: background, logoSizePercent: size });
        const scene = buildScene(currentQR, 640, opts);
        const status = verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status;
        if (status !== "ok") bad.push(background + "/" + size + "/" + status);
      }
    }
    return { modules: currentQR.getModuleCount(), bad: bad };
  });
  expect(result.modules).toBeGreaterThanOrEqual(29);
  expect(result.bad).toEqual([]);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
});

test("logo loads: removing during a load wins, the newest load wins, and old errors disappear", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  const big = await pngBase64(page, 4000, 4000, "#ff0000");
  const tooWide = await pngBase64(page, 4097, 10, "#00ff00");
  const small = await pngBase64(page, 32, 32, "#0000ff");
  const buf = (b) => `Uint8Array.from(atob("${b}"), (c) => c.charCodeAt(0)).buffer`;

  // 1. Remove while a large logo is still being decoded.
  await page.evaluate(`loadLogoBuffer(${buf(big)}); clearLogo();`);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => logoImage === null && logoDataUrl === null)).toBe(true);
  await expect(page.locator("#removeLogo")).toBeHidden();

  // 2. A Swish look chosen while a user logo is loading ends up with the Swish symbol.
  await page.evaluate(`loadLogoBuffer(${buf(big)}); applySwishLook("standard");`);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => logoImage.naturalWidth === logoImage.naturalHeight)).toBe(true);

  // 3. A rejected logo followed by a valid one leaves no error behind.
  await page.evaluate(`loadLogoBuffer(${buf(tooWide)}); loadLogoBuffer(${buf(small)});`);
  await expect(page.locator("#logoPreview img")).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator("#logoError")).toBeHidden();
  expect(await page.evaluate(() => logoImage.naturalWidth)).toBe(32);
});

test("the scan result of a replaced code never shows up under the demo", async ({ guarded: page }) => {
  await openApp(page);
  await page.fill("#ssid", SSID);
  await page.fill("#pswd", PASSWORD);
  await page.waitForTimeout(170); // the code is drawn, its scan check is still waiting
  await chooseType(page, "url"); // the URL demo replaces it
  await page.waitForTimeout(600);
  await expect(page.locator("#demoLabel")).toBeVisible();
  await expect(page.locator("#scanStatus")).toBeHidden();
});

test("download right after a change: exports the latest input and still asks when it cannot be scanned", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await chooseType(page, "text");
  await page.fill("#qrText", "first text");
  await waitForScan(page);

  // Typed and downloaded within the 150 ms debounce: the PNG holds the new text.
  await page.fill("#qrText", "second text");
  const png = await download(page, () => page.click("#download"));
  expect(await decodePng(page, png.data)).toBe("second text");

  // White on white, downloaded before the self-test ran: the confirmation is still shown.
  await waitForScan(page);
  let dialog = null;
  page.once("dialog", (d) => { dialog = d.message(); d.dismiss(); });
  let downloaded = false;
  page.once("download", () => { downloaded = true; });
  await page.evaluate(() => { $("#qrColor").val("#ffffff").trigger("change"); $("#download").trigger("click"); });
  await page.waitForTimeout(300);
  expect(dialog).not.toBeNull();
  expect(downloaded).toBe(false);
});

test("a single-code PDF never runs off the page, whatever width is chosen", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await page.selectOption("#exportFormat", "pdf");
  await page.selectOption("#pdfPaper", "a4");
  await page.selectOption("#pdfOrientation", "portrait");
  await page.fill("#pdfWidthMM", "250");
  const pdf = await download(page, () => page.click("#download"));
  // jsPDF places the image with "w 0 0 h x y cm" (points). A4 is 595.28 × 841.89 pt.
  const m = /([\d.]+) 0 0 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm/.exec(pdfSearchableText(pdf.data));
  expect(m).not.toBeNull();
  const [w, h, x, y] = m.slice(1).map(Number);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x + w).toBeLessThanOrEqual(595.3);
  expect(y + h).toBeLessThanOrEqual(841.9);
});

test("SVG export stays valid XML with control characters, and long emoji titles are cut between characters", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await page.selectOption("#textStyle", "plain");
  await page.evaluate(() => { $("#titleText").val("A\u0001B\u000bC  D").trigger("input"); });
  await waitForScan(page);
  await page.selectOption("#exportFormat", "svg");
  const svg = (await download(page, () => page.click("#download"))).data.toString("utf8");
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return { error: doc.getElementsByTagName("parsererror").length, texts: Array.from(doc.querySelectorAll("text")).map((n) => n.textContent) };
  }, svg);
  expect(parsed.error).toBe(0);
  expect(parsed.texts).toContain("ABC  D");

  const texts = await page.evaluate(() => {
    const opts = Object.assign(getRenderOpts(), { textStyle: "plain", titleText: "Wi-Fi " + "😀".repeat(60) });
    const out = [];
    for (const size of [200, 260, 333, 400, 640]) {
      buildScene(currentQR, size, opts).items.forEach((it) => { if (it.type === "text") out.push(it.text); });
    }
    return out;
  });
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test("errors mark every field that can be wrong", async ({ guarded: page }) => {
  await openApp(page);
  await chooseType(page, "geo");
  await page.fill("#geoLat", "58.9");
  await page.fill("#geoLon", "500");
  await expect(page.locator("#geoLon")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#geoLon")).toHaveAttribute("aria-describedby", /formError/);

  await chooseType(page, "event");
  await page.fill("#evTitle", "Möte");
  await page.fill("#evStartDate", "2026-10-03");
  await expect(page.locator("#evStartTime")).toHaveAttribute("aria-invalid", "true");
});

test("choosing a language with the keyboard keeps focus on the language button", async ({ guarded: page }) => {
  await openApp(page);
  await page.focus("#langBtn");
  await page.keyboard.press("Enter");
  await page.focus(".lang-option[data-code=en]");
  await page.keyboard.press("Enter");
  await expect(page.locator("#langBtn")).toBeFocused();

  // Tabbing out of the open list closes it.
  await page.keyboard.press("Enter");
  await expect(page.locator("#langPopover")).toHaveClass(/open/);
  await page.focus("#ssid");
  await expect(page.locator("#langPopover")).not.toHaveClass(/open/);
});

test("printing the page itself never shows the Wi-Fi password, even when it is visible on screen", async ({ guarded: page }) => {
  await openApp(page);
  await page.selectOption("#security", "WPA");
  await page.click("#generatePwd");
  await expect(page.locator("#pswd")).toHaveAttribute("type", "text");
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("pswd")).visibility)).toBe("hidden");
  await page.emulateMedia({ media: "screen" });
});

test("a design file with a bad logo changes nothing and says so in the design section", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  const good = await pngBase64(page, 64, 64, "#2563eb");
  await page.evaluate((b) => loadLogoBuffer(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer), good);
  await expect(page.locator("#logoPreview img")).toHaveCount(1);
  const before = await page.evaluate(() => ({ shape: $("#qrShape").val(), logo: logoDataUrl }));

  const file = testInfo.outputPath("bad-logo.json");
  const tooWide = await pngBase64(page, 4097, 10, "#00ff00");
  fs.writeFileSync(file, JSON.stringify({
    format: "offline-qr-tools/design", version: 1,
    style: { qrShape: before.shape === "dots" ? "fluid" : "dots" },
    logo: "data:image/png;base64," + tooWide
  }));
  await page.setInputFiles("#designFile", file);
  await expect(page.locator("#designError")).toBeVisible();
  await expect(page.locator("#designError")).toHaveAttribute("data-i18n", "errDesignLogo");
  await expect(page.locator("#designStatus")).toBeHidden();
  const after = await page.evaluate(() => ({ shape: $("#qrShape").val(), logo: logoDataUrl }));
  expect(after).toEqual(before);
});
