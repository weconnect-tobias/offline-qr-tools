"use strict";

// Logo background, error correction level, quiet zone and transparent export.

const fs = require("node:fs");
const { test, expect, openApp, openAllSections, enterNetwork, waitForScan, download } = require("./fixtures");

// FICTIONAL TEST DATA - not a real network or password.
// The values are chosen to be hard to encode: non-ASCII characters (é, Å, ö) test UTF-8,
// and ";" ":" must be escaped in the Wi-Fi format. The tests also check that the password
// never appears as readable text in any export.
const SSID = "Kafé Åkerö";
const PASSWORD = "Hemligt;lösen:1234";

async function uploadLogo(page, testInfo) {
  const file = testInfo.outputPath("logo.png");
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240; c.height = 160; // not square: the cleared area must follow the aspect ratio
    const x = c.getContext("2d");
    x.fillStyle = "#e11d48"; x.fillRect(0, 0, 240, 160);
    x.fillStyle = "#ffffff"; x.fillRect(40, 40, 160, 80);
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  await page.setInputFiles("#logoFile", file);
  await expect(page.locator("#logoPreview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await waitForScan(page);
}

test("logo backgrounds stay scannable at every logo size and several code sizes", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await uploadLogo(page, testInfo);

  const bad = [];
  for (const password of [PASSWORD, "a much longer passphrase for testing 1234567890 abcdefghijkl"]) {
    await enterNetwork(page, SSID, password);
    await waitForScan(page);
    bad.push(...await page.evaluate(() => {
      const out = [];
      for (const background of LOGO_BACKGROUNDS) {
        for (const size of [10, 20, 30]) {
          for (const shape of ["square", "dots", "fluid"]) {
            const opts = Object.assign(getRenderOpts(), { logoBackground: background, logoSizePercent: size, qrShape: shape });
            const scene = buildScene(currentQR, 640, opts);
            const status = verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status;
            if (status !== "ok") out.push([background, size, shape, currentQR.getModuleCount(), status].join("/"));
          }
        }
      }
      return out;
    }));
  }
  expect(bad).toEqual([]);
});

test("the empty logo area removes modules and still decodes on large codes with central alignment patterns", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await enterNetwork(page, SSID, PASSWORD);
  await uploadLogo(page, testInfo);
  const r = await page.evaluate(() => {
    const opts = Object.assign(getRenderOpts(), { logoSizePercent: 30, frameStyle: "none", textStyle: "none" });
    const modulesPath = function(qr, background) {
      return buildScene(qr, 640, Object.assign({}, opts, { logoBackground: background })).items
        .filter(function(it) { return it.type === "path"; })[1].d.length; // [0] QR background, [1] modules
    };
    const fewer = modulesPath(currentQR, "clear") < modulesPath(currentQR, "plate");
    // Versions 7+ have an alignment pattern in the middle, right behind the logo.
    const bad = [];
    for (const len of [150, 400, 800]) {
      const text = Array.from({ length: len }, function(_, i) { return "abcdefghij"[i % 10]; }).join("");
      const qr = qrcode(0, "H");
      qr.addData(text);
      qr.make();
      for (const shape of ["square", "dots"]) {
        const scene = buildScene(qr, 1200, Object.assign({}, opts, { logoBackground: "clear", qrShape: shape }));
        const status = verifyScan(sceneToCanvas(scene), scene.cell, text).status;
        if (status !== "ok") bad.push(len + "/" + shape + "/" + qr.getModuleCount() + "/" + status);
      }
    }
    return { fewer: fewer, bad: bad };
  });
  expect(r.fewer).toBe(true);
  expect(r.bad).toEqual([]);
});

test("error correction: automatic level, manual choice and forced H with a logo", async ({ guarded: page }, testInfo) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  const count = () => page.evaluate(() => currentQR.getModuleCount());

  await page.selectOption("#ecLevel", "L");
  await waitForScan(page);
  const low = await count();
  await page.selectOption("#ecLevel", "H");
  await waitForScan(page);
  const high = await count();
  expect(low).toBeLessThan(high);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");

  await page.selectOption("#ecLevel", "L");
  await uploadLogo(page, testInfo);
  expect(await count()).toBe(high);
  await expect(page.locator("#ecLogoNote")).toBeVisible();
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");

  await page.click("#removeLogo");
  await waitForScan(page);
  expect(await count()).toBe(low);
  await expect(page.locator("#ecLogoNote")).toBeHidden();
});

test("every quiet zone choice decodes; a narrow one gives larger modules", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  const cells = {};
  for (const zone of ["2", "4", "6"]) {
    await page.selectOption("#quietZone", zone);
    await waitForScan(page);
    await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");
    await expect(page.locator("#quietZoneNote")).toBeVisible({ visible: zone === "2" });
    cells[zone] = await page.evaluate(() => buildScene(currentQR, 640, getRenderOpts()).cell);
  }
  expect(cells["2"]).toBeGreaterThan(cells["4"]);
  expect(cells["4"]).toBeGreaterThan(cells["6"]);
});

test("transparent PNG and SVG exports leave out the background but keep paper frames", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await page.evaluate(() => $("#qrBgColor").val("#fde68a").trigger("change"));
  await page.check("#transparentBg");

  await page.selectOption("#exportFormat", "png");
  const png = await download(page, () => page.click("#download"));
  const alpha = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Corner (page) and a point inside the quiet zone.
    const quiet = Math.round(c.width * 0.02);
    return [ctx.getImageData(1, 1, 1, 1).data[3], ctx.getImageData(quiet, quiet, 1, 1).data[3]];
  }, png.data.toString("base64"));
  expect(alpha).toEqual([0, 0]);

  await page.selectOption("#exportFormat", "svg");
  const svg = (await download(page, () => page.click("#download"))).data.toString("utf8");
  expect(svg).not.toContain("#fde68a");

  // On a card the QR keeps its background, otherwise the card colour would show through.
  await page.selectOption("#frameStyle", "card");
  const card = (await download(page, () => page.click("#download"))).data.toString("utf8");
  expect(card).toContain("#fde68a");

  // PDF is paper: the option is hidden and has no effect.
  await page.selectOption("#exportFormat", "pdf");
  await expect(page.locator("#transparentWrap")).toBeHidden();
});

test("custom gradient angle: slider only for that option, decodes at every angle", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await expect(page.locator("#gradientAngleWrap")).toBeHidden();
  await page.selectOption("#gradient", "angle");
  await expect(page.locator("#gradientAngleWrap")).toBeVisible();
  await page.locator("#gradientAngle").fill("120");
  await expect(page.locator("#gradientAngle")).toHaveAttribute("aria-valuetext", "120°");
  await expect(page.locator("#gradientAngleValue")).toHaveText("120°");
  await waitForScan(page);
  await expect(page.locator("#scanStatus")).toHaveAttribute("data-state", "ok");

  const bad = await page.evaluate(() => {
    const out = [];
    for (let angle = 0; angle < 360; angle += 30) {
      const opts = Object.assign(getRenderOpts(), { gradient: "angle", gradientAngle: angle, gradientColor2: "#1e3a8a", qrShape: "dots" });
      const scene = buildScene(currentQR, 640, opts);
      if (verifyScan(sceneToCanvas(scene), scene.cell, currentPayload).status !== "ok") out.push(angle);
      if (!/<linearGradient id="qrg[0-9a-f]{16}"/.test(sceneToSVG(scene))) out.push("svg" + angle);
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test("ready-made caption texts follow the content type and turn text on", async ({ guarded: page }) => {
  await openApp(page);
  await openAllSections(page);
  await enterNetwork(page, SSID, PASSWORD);
  await page.selectOption("#textStyle", "none");
  await page.selectOption("#textStyle", "plain"); // the buttons live in the text section
  const wifiKeys = await page.locator("#captionSuggestions button").evaluateAll((els) => els.map((e) => e.dataset.caption));
  expect(wifiKeys).toEqual(["ctaScanMe", "ctaFreeWifi", "ctaGuestWifi"]);

  await page.selectOption("#textStyle", "none");
  await page.evaluate(() => $("#captionSuggestions button[data-caption=ctaFreeWifi]").trigger("click"));
  await expect(page.locator("#textStyle")).toHaveValue("plain");
  await expect(page.locator("#captionText")).toHaveValue("Gratis Wi-Fi – skanna för att ansluta");
  await waitForScan(page);
  expect(await page.evaluate(() => getRenderOpts().caption)).toBe("Gratis Wi-Fi – skanna för att ansluta");

  await page.click("input[name=qrType][value=url] + span");
  const urlKeys = await page.locator("#captionSuggestions button").evaluateAll((els) => els.map((e) => e.dataset.caption));
  expect(urlKeys).toEqual(["ctaScanMe", "ctaVisitSite", "ctaSeeMenu", "ctaReadMore"]);
});
