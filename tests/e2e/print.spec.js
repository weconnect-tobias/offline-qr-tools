"use strict";

const { test, expect, openApp, openAllSections, enterNetwork, pdfSearchableText, download } = require("./fixtures");

const SSID = "Kafé Åkerö";
const PASSWORD = "Topsecret-4711";

test.beforeEach(async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await openAllSections(page);
});

test("there is no option to print the password", async ({ guarded: page }) => {
  await expect(page.locator("#printShowPassword")).toHaveCount(0);
  await expect(page.locator("#printSection")).not.toContainText(/print the password|skriv ut lösenordet/i);
});

for (const layout of ["sign", "tent", "cards"]) {
  test(`${layout}: every QR code on the page decodes and the PDF never contains the password`, async ({ guarded: page }) => {
    await page.selectOption("#printLayout", layout);
    await page.check("#printShowSsid");
    await page.waitForTimeout(400);

    // Render the page model and decode each placed QR artwork from the page image itself.
    const result = await page.evaluate(() => {
      const pageModel = buildPrintPage();
      const pxPerMm = 8;
      const canvas = pageToCanvas(pageModel, pxPerMm);
      const images = pageModel.items.filter((it) => it.type === "image" && /^qr/.test(it.alias));
      const decoded = images.map((it) => {
        const c = document.createElement("canvas");
        c.width = Math.round(it.w * pxPerMm); c.height = Math.round(it.h * pxPerMm);
        c.getContext("2d").drawImage(canvas, it.x * pxPerMm, it.y * pxPerMm, c.width, c.height, 0, 0, c.width, c.height);
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
        const r = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
        return r ? new TextDecoder().decode(new Uint8Array(r.binaryData)) : null;
      });
      return { decoded, expected: currentPayload, moduleMm: pageModel.moduleMm, w: pageModel.w, h: pageModel.h };
    });
    const expectedCount = { sign: 1, tent: 2, cards: 10 }[layout];
    expect(result.decoded).toHaveLength(expectedCount);
    for (const text of result.decoded) expect(text).toBe(result.expected);
    expect(result.w).toBe(210);
    expect(result.h).toBe(297);
    expect(result.moduleMm).toBeGreaterThan(0.4);

    const pdf = await download(page, () => page.click("#printDownload"));
    expect(pdf.name).toBe(`qr-wifi-${layout}.pdf`);
    const text = pdfSearchableText(pdf.data);
    expect(text).toContain(Buffer.from(SSID, "latin1").toString("latin1")); // opted-in network name
    expect(text).not.toContain(PASSWORD);
    expect(pdf.data.length).toBeLessThan(500 * 1024);
  });
}

test("card sheet on Letter paper fits 8 cards; small dots trigger a warning", async ({ guarded: page }) => {
  await page.selectOption("#printLayout", "cards");
  await page.selectOption("#printPaper", "letter");
  await page.waitForTimeout(300);
  const images = await page.evaluate(() => buildPrintPage().items.filter((it) => it.type === "image").length);
  expect(images).toBe(8);
  await expect(page.locator("#printStatus")).toHaveAttribute("data-state", /ok|warn/);

  // A very dense payload makes card-sized modules too small to print reliably.
  await page.fill("#ssid", "X".repeat(32));
  await page.fill("#pswd", "Y".repeat(63));
  await page.selectOption("#frameStyle", "ribbon");
  await page.waitForTimeout(700);
  await expect(page.locator("#printStatus")).toHaveAttribute("data-state", /warn|fail/);
});
