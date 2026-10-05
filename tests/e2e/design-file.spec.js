"use strict";

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork, waitForScan, download } = require("./fixtures");

// FICTIONAL TEST DATA - not a real network or password.
// The values are chosen to be hard to encode: non-ASCII characters (é, Å, ö) test UTF-8,
// and ";" ":" must be escaped in the Wi-Fi format. The tests also check that the password
// never appears as readable text in any export.
const SSID = "Kafé Åkerö";
const PASSWORD = "Hemligt;lösen:1234";

async function setStyle(page) {
  await page.selectOption("#qrShape", "hearts");
  await page.selectOption("#eyeStyle", "pointed");
  await page.selectOption("#gradient", "angle");
  await page.locator("#gradientAngle").fill("120");
  await page.evaluate(() => $("#qrColor").val("#7c2d12").trigger("change"));
  await page.selectOption("#frameStyle", "stamp");
  await page.selectOption("#textStyle", "banner");
  await page.fill("#titleText", "Topsecret heading");
  await page.fill("#captionText", "Password: " + "Hemligt;lösen:1234");
  await page.selectOption("#quietZone", "2");
}

test("a design is saved without content and opens again, logo included", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await setStyle(page);

  const logo = testInfo.outputPath("logo.png");
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 120;
    const x = c.getContext("2d"); x.fillStyle = "#0f766e"; x.fillRect(0, 0, 120, 120);
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(logo, Buffer.from(dataUrl.split(",")[1], "base64"));
  await page.setInputFiles("#logoFile", logo);
  await expect(page.locator("#designLogoWrap")).toBeVisible();
  await waitForScan(page);

  const saved = await download(page, () => page.click("#saveDesign"));
  expect(saved.name).toBe("qr-design.json");
  const json = saved.data.toString("utf8");
  for (const secret of [SSID, PASSWORD, "Hemligt", "Topsecret", "Password"]) expect(json).not.toContain(secret);
  const design = JSON.parse(json);
  expect(design.style.qrShape).toBe("hearts");
  expect(design.logo).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator("#designStatus")).toHaveAttribute("data-i18n", "designSaved");

  // Reset to something else, then open the file.
  await page.click("#removeLogo");
  await page.selectOption("#qrShape", "square");
  await page.selectOption("#eyeStyle", "square");
  await page.selectOption("#gradient", "none");
  await page.selectOption("#frameStyle", "none");
  await page.selectOption("#quietZone", "4");
  const file = testInfo.outputPath("qr-design.json");
  fs.writeFileSync(file, saved.data);
  await page.setInputFiles("#designFile", file);

  await expect(page.locator("#designStatus")).toHaveAttribute("data-i18n", "designOpened");
  await expect(page.locator("#qrShape")).toHaveValue("hearts");
  await expect(page.locator("#eyeStyle")).toHaveValue("pointed");
  await expect(page.locator("#gradient")).toHaveValue("angle");
  await expect(page.locator("#gradientAngle")).toHaveValue("120");
  await expect(page.locator("#gradientAngleWrap")).toBeVisible();
  await expect(page.locator("#qrColor")).toHaveValue("#7c2d12");
  await expect(page.locator("#frameStyle")).toHaveValue("stamp");
  await expect(page.locator("#quietZone")).toHaveValue("2");
  await expect(page.locator("#logoPreview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  // Texts are untouched by opening a design.
  await expect(page.locator("#titleText")).toHaveValue("Topsecret heading");
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).not.toHaveAttribute("data-state", "fail");
});

test("broken and hostile design files are rejected with an accessible error", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);

  const cases = [
    ["broken.json", "{ not json", "errDesignInvalid"],
    ["svg-logo.json", JSON.stringify({ format: "offline-qr-tools/design", version: 1, style: {}, logo: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" }), "errDesignLogo"],
    ["future.json", JSON.stringify({ format: "offline-qr-tools/design", version: 9, style: {} }), "errDesignVersion"]
  ];
  for (const [name, content, key] of cases) {
    const file = testInfo.outputPath(name);
    fs.writeFileSync(file, content);
    await page.setInputFiles("#designFile", file);
    await expect(page.locator("#designError")).toHaveAttribute("data-i18n", key);
    await expect(page.locator("#designError")).toHaveAttribute("role", "alert");
  }

  // A PNG header with garbage behind it passes the format check but fails decoding in the logo
  // pipeline. The logo is checked before anything is applied, so the file changes nothing.
  const fake = testInfo.outputPath("fake-logo.json");
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from("<script>alert(1)</script>")]);
  fs.writeFileSync(fake, JSON.stringify({ format: "offline-qr-tools/design", version: 1, style: { qrShape: "dots", qrColor: "\"><script>" }, logo: "data:image/png;base64," + bytes.toString("base64") }));
  const shapeBefore = await page.locator("#qrShape").inputValue();
  await page.setInputFiles("#designFile", fake);
  await expect(page.locator("#designError")).toHaveAttribute("data-i18n", "errDesignLogo");
  await expect(page.locator("#designStatus")).toBeHidden();
  await expect(page.locator("#qrShape")).toHaveValue(shapeBefore);
  await expect(page.locator("#qrColor")).toHaveValue("#000000");

  // The same file without the logo opens, and the invalid colour is skipped.
  fs.writeFileSync(fake, JSON.stringify({ format: "offline-qr-tools/design", version: 1, style: { qrShape: "dots", qrColor: "\"><script>" } }));
  await page.setInputFiles("#designFile", fake);
  await expect(page.locator("#designStatus")).toHaveAttribute("data-i18n", "designOpenedPartly");
  await expect(page.locator("#qrShape")).toHaveValue("dots");
  await expect(page.locator("#qrColor")).toHaveValue("#000000");
});
