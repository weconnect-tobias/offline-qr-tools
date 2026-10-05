"use strict";

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork, waitForScan, decodePng, pdfSearchableText, download } = require("./fixtures");

// FICTIONAL TEST DATA - not a real network or password.
// The values are chosen to be hard to encode: non-ASCII characters (é, Å, ö) test UTF-8,
// and ";" ":" must be escaped in the Wi-Fi format. The tests also check that the password
// never appears as readable text in any export.
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
      for (const [i, shape] of Object.keys(MODULE_SHAPES).entries()) {
        const eyeStyle = Object.keys(EYE_STYLES)[i % Object.keys(EYE_STYLES).length];
        const opts = Object.assign(getRenderOpts(), { frameStyle: frame, qrShape: shape, eyeStyle: eyeStyle, textStyle: "plain", title: "Gäst-WiFi", caption: "Skanna mig", wifiIcon: true });
        const scene = buildScene(currentQR, 640, opts);
        if (verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status !== "ok") bad.push(frame + "/" + shape + "/" + eyeStyle);
      }
    }
    return bad;
  });
  expect(failures).toEqual([]);
});

test("every dot shape x corner style x gradient stays scannable", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  const result = await page.evaluate(() => {
    const bad = [];
    let count = 0;
    for (const shape of Object.keys(MODULE_SHAPES)) {
      for (const eye of Object.keys(EYE_STYLES)) {
        for (const gradient of GRADIENT_TYPES) {
          // Alternate the custom eye colour so both code paths are covered without doubling the grid.
          const eyeColor = count % 2 ? "#b91c1c" : null;
          for (const size of [480, 640]) {
            const opts = Object.assign(getRenderOpts(), { frameStyle: "none", textStyle: "none", title: "", caption: "",
              qrShape: shape, eyeStyle: eye, gradient: gradient, qrColor: "#000000", gradientColor2: "#1e3a8a", eyeColor: eyeColor });
            const scene = buildScene(currentQR, size, opts);
            const status = verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status;
            if (status !== "ok") bad.push([shape, eye, gradient, size, status].join("/"));
          }
          count++;
        }
      }
    }
    return { bad: bad, count: count };
  });
  expect(result.count).toBeGreaterThanOrEqual(8 * 5 * 5);
  expect(result.bad).toEqual([]);
});

test("gradients and custom eye colours are valid in the SVG export", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  const svgs = await page.evaluate(() => GRADIENT_TYPES.map(function(gradient) {
    const opts = Object.assign(getRenderOpts(), { gradient: gradient, gradientColor2: "#1e3a8a", eyeColor: "#b91c1c", eyeStyle: "circle" });
    return sceneToSVG(buildScene(currentQR, 400, opts));
  }));
  for (const [i, svg] of svgs.entries()) {
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain("#b91c1c");
    if (i === 0) expect(svg).not.toContain("Gradient");
    else expect(svg).toMatch(/<(linear|radial)Gradient id="qrg[0-9a-f]{16}" gradientUnits="userSpaceOnUse"/);
  }
  // Well-formed XML: the browser's parser reports errors as a <parsererror> element.
  const errors = await page.evaluate((list) => list.filter(function(svg) {
    return new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror").length > 0;
  }).length, svgs);
  expect(errors).toBe(0);
});

test("style controls: registry options, presets and conditional pickers", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await openAllSections(page);
  const moduleIds = await page.evaluate(() => Object.keys(MODULE_SHAPES));
  await expect(page.locator("#qrShape option")).toHaveCount(moduleIds.length);
  await expect(page.locator("#qrShape option[value=fluid]")).toHaveText("Flytande (sammanhängande)");

  await expect(page.locator("#gradientColor2Wrap")).toBeHidden();
  await page.selectOption("#gradient", "radial");
  await expect(page.locator("#gradientColor2Wrap")).toBeVisible();

  await expect(page.locator("#eyeColorWrap")).toBeHidden();
  await page.check("#customEyeColor");
  await expect(page.locator("#eyeColorWrap")).toBeVisible();

  await page.click("[data-preset=elegant]");
  await expect(page.locator("#qrShape")).toHaveValue("classy");
  await expect(page.locator("#eyeStyle")).toHaveValue("leaf");
  await expect(page.locator("#eyeStyle option")).toHaveCount(await page.evaluate(() => Object.keys(EYE_STYLES).length));
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");

  // A light second gradient colour on white must trigger the contrast warning.
  await page.selectOption("#gradient", "vertical");
  await page.evaluate(() => $("#gradientColor2").val("#fde68a").trigger("change"));
  await expect(page.locator("#contrastWarning")).toBeVisible();
});

test("polaroid frame switches the default dark paper to white and stays scannable", async ({ guarded: page }) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await openAllSections(page);
  await page.selectOption("#frameStyle", "polaroid");
  await expect(page.locator("#frameColor")).toHaveValue("#ffffff");
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
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

test("strong password generator: fills the field, shows it, reminds about the router", async ({ guarded: page }) => {
  await openApp(page);
  await page.fill("#ssid", SSID);
  await page.click("#generatePwd");
  const pwd = await page.inputValue("#pswd");
  expect(pwd).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{5}(-[a-km-np-zA-HJ-NP-Z2-9]{5}){3}$/);
  await expect(page.locator("#pswd")).toHaveAttribute("type", "text");
  await expect(page.locator("#togglePwd")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#genPwdNote")).toBeVisible();
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
  expect(await page.evaluate(() => currentPayload)).toContain(";P:" + pwd + ";");

  // A second click gives a different password.
  await page.click("#generatePwd");
  expect(await page.inputValue("#pswd")).not.toBe(pwd);

  // Typing by hand hides the reminder; WEP and enterprise have no generator.
  await page.fill("#pswd", "my own passphrase");
  await expect(page.locator("#genPwdNote")).toBeHidden();
  await page.selectOption("#security", "WEP");
  await expect(page.locator("#generatePwd")).toBeHidden();
  await page.selectOption("#security", "WPA2-EAP");
  await expect(page.locator("#generatePwd")).toBeHidden();
});
