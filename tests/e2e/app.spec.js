"use strict";

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork, waitForScan, decodePng, pdfSearchableText, download } = require("./fixtures");

const SSID = "Kafé Åkerö";
const PASSWORD = "Hemligt;lösen:1234";
const PAYLOAD = "WIFI:T:WPA;S:Kafé Åkerö;P:Hemligt\\;lösen\\:1234;H:false;;";

test("starts in demo mode without errors, CSP violations or network requests", async ({ guarded: page }) => {
  await openApp(page);
  await expect(page.locator("#download")).toBeDisabled();
  await expect(page.locator("#demoLabel")).toBeVisible();
  await expect(page.locator("#scanStatus")).toBeHidden();
});

test("valid network passes the scan self-test and the PNG decodes to the exact payload", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  await expect(page.locator("#download")).toBeEnabled();
  expect(await page.evaluate(() => currentPayload)).toBe(PAYLOAD);

  await openAllSections(page);
  await page.selectOption("#exportFormat", "png");
  const png = await download(page, () => page.click("#download"));
  expect(png.name).toBe("qr-wifi.png");
  expect(await decodePng(page, png.data)).toBe(PAYLOAD);
});

test("SVG and PDF exports never contain the password as text", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, "Topsecret-4711");
  await openAllSections(page);
  await page.selectOption("#textStyle", "plain");
  await page.fill("#titleText", "Guest Wi-Fi");
  await waitForScan(page);

  await page.selectOption("#exportFormat", "svg");
  const svg = await download(page, () => page.click("#download"));
  const svgText = svg.data.toString("utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("Guest Wi-Fi");
  expect(svgText).not.toContain("Topsecret");

  await page.selectOption("#exportFormat", "pdf");
  const pdf = await download(page, () => page.click("#download"));
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfSearchableText(pdf.data)).not.toContain("Topsecret");
  expect(pdf.data.length).toBeLessThan(300 * 1024); // compression guard (jsPDF 4 default is uncompressed)
});

test("every frame style and dot shape stays scannable", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  const failures = await page.evaluate(() => {
    const bad = [];
    for (const frame of Object.keys(FRAME_TEMPLATES)) {
      for (const shape of ["square", "rounded", "dots"]) {
        const opts = Object.assign(getRenderOpts(), { frameStyle: frame, qrShape: shape, textStyle: "plain", title: "Gäst-WiFi", caption: "Skanna mig", wifiIcon: true });
        const scene = buildScene(currentQR, 640, opts);
        if (verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status !== "ok") bad.push(frame + "/" + shape);
      }
    }
    return bad;
  });
  expect(failures).toEqual([]);
});

test("invalid WPA password shows an error tied to the field", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, "short");
  await expect(page.locator("#formError")).toBeVisible();
  await expect(page.locator("#pswd")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#pswd")).toHaveAttribute("aria-describedby", /formError/);
  await expect(page.locator("#download")).toBeDisabled();

  await page.fill("#pswd", "long enough now");
  await waitForScan(page);
  await expect(page.locator("#formError")).toBeHidden();
  await expect(page.locator("#pswd")).not.toHaveAttribute("aria-invalid", "true");
});

test("typing the password into the caption shows a warning", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, "Topsecret-4711");
  await openAllSections(page);
  await page.selectOption("#textStyle", "plain");
  await page.fill("#captionText", "Password: topsecret-4711");
  await waitForScan(page);
  await expect(page.locator("#textPasswordWarning")).toBeVisible();
  await page.fill("#captionText", "Scan me");
  await waitForScan(page);
  await expect(page.locator("#textPasswordWarning")).toBeHidden();
});

test("logo upload rejects disguised and oversized files and accepts a PNG", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await openAllSections(page);

  const fake = testInfo.outputPath("fake.png");
  fs.writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  await page.setInputFiles("#logoFile", fake);
  await expect(page.locator("#logoError")).toHaveAttribute("data-i18n", "logoErrType");

  const big = testInfo.outputPath("big.png");
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 1));
  await page.setInputFiles("#logoFile", big);
  await expect(page.locator("#logoError")).toHaveAttribute("data-i18n", "logoErrSize");

  const real = testInfo.outputPath("logo.png");
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 200;
    const x = c.getContext("2d"); x.fillStyle = "#e11d48"; x.beginPath(); x.arc(100, 100, 90, 0, 7); x.fill();
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(real, Buffer.from(dataUrl.split(",")[1], "base64"));
  await page.setInputFiles("#logoFile", real);
  await expect(page.locator("#logoPreview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator("#logoError")).toBeHidden();
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
});

test("switching language translates every labelled element", async ({ guarded: page }) => {
  await openApp(page);
  await page.click("#langBtn");
  await page.click(".lang-option[data-code=en]");
  const untranslated = await page.evaluate(() => $("[data-i18n]").toArray()
    .filter((el) => $(el).text() !== I18N.en[$(el).attr("data-i18n")])
    .map((el) => el.getAttribute("data-i18n")));
  expect(untranslated).toEqual([]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
