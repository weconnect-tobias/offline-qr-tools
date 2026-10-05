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
  { type: "geo", fill: { "#geoLat": "58,9395", "#geoLon": "11.1712" }, payload: "geo:58.9395,11.1712" },
  { type: "event", fill: { "#evTitle": "Öppet hus", "#evLocation": "Storgatan 1", "#evStartDate": "2026-10-03", "#evStartTime": "14:00", "#evEndTime": "16:00" },
    payload: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//offline-qr-tools//EN\r\nBEGIN:VEVENT\r\nUID:134a0afe6c9a33c0@offline-qr-tools\r\n" +
      "DTSTAMP:20261003T000000Z\r\nSUMMARY:Öppet hus\r\nDTSTART:20261003T140000\r\nDTEND:20261003T160000\r\nLOCATION:Storgatan 1\r\nEND:VEVENT\r\nEND:VCALENDAR",
    caption: "Öppet hus" },
  { type: "swish", fill: { "#swNumber": "123 123 45 67", "#swAmount": "150", "#swMessage": "Kaffe & bulle" },
    payload: "https://app.swish.nu/1/p/sw/?sw=1231234567&amt=150&cur=SEK&msg=Kaffe%20%26%20bulle&src=qr", caption: "123 123 45 67" }
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

test("event: all day hides the time fields; a reversed range shows an error tied to the end date", async ({ guarded: page }) => {
  await openApp(page);
  await page.click("input[name=qrType][value=event] + span");
  await page.fill("#evTitle", "Mässa");
  await page.fill("#evStartDate", "2026-10-03");
  await page.fill("#evStartTime", "10:00");
  await page.fill("#evEndDate", "2026-10-01");
  await expect(page.locator("#formError")).toHaveAttribute("data-i18n", "errEventEnd");
  await expect(page.locator("#evEndDate")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#download")).toBeDisabled();

  await page.fill("#evEndDate", "2026-10-04");
  await page.check("#evAllDay");
  await expect(page.locator("#evStartTime")).toBeHidden();
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  expect(await page.evaluate(() => currentPayload)).toContain("DTSTART;VALUE=DATE:20261003\r\nDTEND;VALUE=DATE:20261005");
});

test("swish: an invalid number is tied to its field; the code is a link and makes no request", async ({ guarded: page }) => {
  await openApp(page);
  await page.click("input[name=qrType][value=swish] + span");
  await page.fill("#swNumber", "0812345678");
  await expect(page.locator("#formError")).toHaveAttribute("data-i18n", "errSwishNumber");
  await expect(page.locator("#swNumber")).toHaveAttribute("aria-invalid", "true");
  await page.fill("#swNumber", "070-123 45 67");
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  expect(await page.evaluate(() => currentPayload)).toBe("https://app.swish.nu/1/p/sw/?sw=0701234567&msg=&edit=msg&src=qr");
});

test("swish: lock boxes follow their fields until clicked; an empty message can be locked, an empty amount cannot", async ({ guarded: page }) => {
  await openApp(page);
  await page.click("input[name=qrType][value=swish] + span");
  await page.fill("#swNumber", "0701234567");
  await expect(page.locator("#swAmountLocked")).toBeDisabled();
  await page.fill("#swAmount", "50");
  await expect(page.locator("#swAmountLocked")).toBeEnabled();
  await expect(page.locator("#swAmountLocked")).toBeChecked();
  await expect(page.locator("#swMessageLocked")).not.toBeChecked();

  // Lock the empty message: same link as Swish's own generator ("msg=" without edit).
  await page.check("#swMessageLocked");
  await waitForScan(page);
  expect(await page.evaluate(() => currentPayload)).toBe("https://app.swish.nu/1/p/sw/?sw=0701234567&amt=50&cur=SEK&msg=&src=qr");

  // A manual choice is kept when the field changes.
  await page.uncheck("#swAmountLocked");
  await page.fill("#swAmount", "75");
  await expect(page.locator("#swAmountLocked")).not.toBeChecked();

  // Clearing the amount makes it open again and disables its lock.
  await page.fill("#swAmount", "");
  await expect(page.locator("#swAmountLocked")).toBeDisabled();
  await waitForScan(page);
  expect(await page.evaluate(() => currentPayload)).toBe("https://app.swish.nu/1/p/sw/?sw=0701234567&msg=&src=qr");
});

test("swish: the recommended looks add the bundled Swish symbol and stay scannable", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await page.click("input[name=qrType][value=swish] + span");
  await page.fill("#swNumber", "1231234567");

  const looks = { standard: ["#000000", "none"], bw: ["#000000", "none"], gradient: ["#6835ed", "angle"] };
  const symbols = {};
  for (const [look, [qrColor, gradient]] of Object.entries(looks)) {
    await page.click(`[data-swish-look=${look}]`);
    await expect(page.locator("#logoPreview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.locator("#eyeStyle")).toHaveValue("rounded");
    await expect(page.locator("#qrColor")).toHaveValue(qrColor);
    await expect(page.locator("#gradient")).toHaveValue(gradient);
    await expect(page.locator("#logoSize")).toHaveValue("25");
    await expect(page.locator("#logoBackground")).toHaveValue("clear");
    await expect(page.locator("#textStyle")).toHaveValue("plain");
    await expect(page.locator("#captionText")).toHaveValue("Betala med Swish");
    await waitForScan(page);
    await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
    // Which symbol was used: count coloured pixels of the re-encoded logo.
    symbols[look] = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = logoImage.naturalWidth; c.height = logoImage.naturalHeight;
      const x = c.getContext("2d"); x.drawImage(logoImage, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let coloured = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) coloured++;
      return coloured;
    });
  }
  expect(symbols.standard).toBeGreaterThan(1000);
  expect(symbols.gradient).toBeGreaterThan(1000);
  expect(symbols.bw).toBe(0);

  // Exports work (the symbol is embedded as a data URL, so the canvas is never tainted).
  await page.selectOption("#exportFormat", "png");
  const png = await download(page, () => page.click("#download"));
  expect(await decodePng(page, png.data)).toBe("https://app.swish.nu/1/p/sw/?sw=1231234567&msg=&edit=msg&src=qr");
});
