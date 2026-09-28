"use strict";

const { test, expect, openApp, openAllSections, waitForScan, decodePng, pdfSearchableText, download } = require("./fixtures");

// For every type: fill the form, check the self-test, download the PNG and decode it.
const CASES = [
  { type: "url", fill: { "#urlInput": "exempel.se/meny?bord=4" }, payload: "https://exempel.se/meny?bord=4", caption: "exempel.se/meny" },
  { type: "text", fill: { "#qrText": "Välkommen!\nFrukost 7–10" }, payload: "Välkommen!\nFrukost 7–10" },
  { type: "email", fill: { "#emailTo": "info@exempel.se", "#emailSubject": "Bokning" }, payload: "mailto:info@exempel.se?subject=Bokning", caption: "info@exempel.se" },
  { type: "phone", fill: { "#phoneNumber": "+46 70 123 45 67" }, payload: "tel:+46701234567" },
  { type: "sms", fill: { "#smsNumber": "070-123 45 67", "#smsMessage": "Hej!" }, payload: "SMSTO:0701234567:Hej!" },
  { type: "vcard", fill: { "#vcFirst": "Anna", "#vcLast": "Åkerö", "#vcPhone": "+46701234567" },
    payload: "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Åkerö;Anna;;;\r\nFN:Anna Åkerö\r\nTEL;TYPE=CELL:+46701234567\r\nEND:VCARD", caption: "Anna Åkerö" },
  { type: "geo", fill: { "#geoLat": "58,9395", "#geoLon": "11.1712" }, payload: "geo:58.9395,11.1712" }
];

for (const c of CASES) {
  test(`${c.type}: form → scan self-test → PNG decodes to the exact payload`, async ({ guarded: page }) => {
    await openApp(page);
    await page.click(`input[name=qrType][value=${c.type}] + span`);
    await expect(page.locator(`.type-panel[data-type=${c.type}]`)).toBeVisible();
    await expect(page.locator(".type-panel[data-type=wifi]")).toBeHidden();
    expect(new URL(page.url()).hash).toBe("#" + c.type);

    for (const [sel, value] of Object.entries(c.fill)) await page.fill(sel, value);
    await waitForScan(page);
    await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
    expect(await page.evaluate(() => currentPayload)).toBe(c.payload);

    if (c.caption) {
      await openAllSections(page);
      await page.selectOption("#textStyle", "plain");
      await waitForScan(page);
      const caption = await page.evaluate(() => getRenderOpts().caption);
      expect(caption).toContain(c.caption);
    }

    await openAllSections(page);
    await page.selectOption("#exportFormat", "png");
    const png = await download(page, () => page.click("#download"));
    expect(png.name).toBe(`qr-${c.type}.png`);
    expect(await decodePng(page, png.data)).toBe(c.payload);
  });
}

test("dangerous URLs are rejected with an accessible error and no code is produced", async ({ guarded: page }) => {
  await openApp(page, "/index.html#url");
  await expect(page.locator(".type-panel[data-type=url]")).toBeVisible();
  for (const bad of ["javascript:alert(document.cookie)", "https://bank.example@evil.example/login"]) {
    await page.fill("#urlInput", bad);
    await waitForScan(page);
    await expect(page.locator("#formError")).toBeVisible();
    await expect(page.locator("#urlInput")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#download")).toBeDisabled();
    expect(await page.evaluate(() => currentPayload)).toBeNull();
  }
});

test("http and punycode URLs show a warning but still work", async ({ guarded: page }) => {
  await openApp(page, "/index.html#url");
  await page.fill("#urlInput", "http://example.com");
  await waitForScan(page);
  await expect(page.locator("#typeWarning")).toHaveAttribute("data-i18n", "warnUrlHttp");
  await page.fill("#urlInput", "https://xn--pple-43d.com");
  await waitForScan(page);
  await expect(page.locator("#typeWarning")).toHaveAttribute("data-i18n", "warnUrlPunycode");
  await expect(page.locator("#download")).toBeEnabled();
  await page.fill("#urlInput", "https://example.com");
  await waitForScan(page);
  await expect(page.locator("#typeWarning")).toBeHidden();
});

test("deep link opens the right type; unknown hashes fall back to Wi-Fi", async ({ guarded: page }) => {
  await openApp(page, "/index.html#vcard");
  await expect(page.locator("input[name=qrType][value=vcard]")).toBeChecked();
  // Same-document navigation (only the hash changes) must also switch type.
  await page.goto("/index.html#geo");
  await expect(page.locator("input[name=qrType][value=geo]")).toBeChecked();
  await expect(page.locator(".type-panel[data-type=geo]")).toBeVisible();
  // Unknown or malicious hashes fall back to Wi-Fi and are removed from the address.
  await page.goto("/index.html#<img src=x onerror=alert(1)>");
  await expect(page.locator("input[name=qrType][value=wifi]")).toBeChecked();
  expect(new URL(page.url()).hash).toBe("#wifi");
});

test("type picker is keyboard operable (arrow keys move between radios)", async ({ guarded: page }) => {
  await openApp(page);
  await page.focus("input[name=qrType][value=wifi]");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("input[name=qrType][value=url]")).toBeChecked();
  await expect(page.locator(".type-panel[data-type=url]")).toBeVisible();
});

test("print layout for a URL shows the address and URL-specific instructions", async ({ guarded: page }) => {
  await openApp(page, "/index.html#url");
  await page.fill("#urlInput", "exempel.se/meny");
  await waitForScan(page);
  await openAllSections(page);
  await expect(page.locator("#printShowLabel")).toHaveAttribute("data-i18n", "printShowSummaryLabel");
  await page.check("#printShowSsid");
  await page.waitForTimeout(400);
  const pdf = await download(page, () => page.click("#printDownload"));
  expect(pdf.name).toBe("qr-url-sign.pdf");
  const text = pdfSearchableText(pdf.data);
  expect(text).toContain("exempel.se/meny");
  expect(text).toContain("Besök oss");
  expect(text).not.toContain("ansluta"); // Wi-Fi wording must not leak into other types
});

test("Wi-Fi-only options are hidden for other types", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await expect(page.locator("#wifiIcon")).toBeVisible();
  await page.click("input[name=qrType][value=phone] + span");
  await expect(page.locator("#wifiIcon")).toBeHidden();
});
