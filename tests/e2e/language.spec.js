"use strict";

const { test, expect, openApp } = require("./fixtures");

async function uiLanguage(page) {
  return page.evaluate(() => ({ lang: document.documentElement.lang, h1: $("h1").text(), ssidLabel: $("label[for=ssid]").text() }));
}

test.describe("computer set to English", () => {
  test.use({ locale: "en-US" });

  test("opens in English", async ({ guarded: page }) => {
    await openApp(page);
    const ui = await uiLanguage(page);
    expect(ui.lang).toBe("en");
    expect(ui.ssidLabel).toBe("Network name (SSID)");
    await expect(page.locator("#langBtnName")).toHaveText("English");
  });

  test("?lang=sv in the link overrides the browser language without being saved", async ({ guarded: page }) => {
    await openApp(page, "/index.html?lang=sv#url");
    expect((await uiLanguage(page)).lang).toBe("sv");
    await expect(page.locator("input[name=qrType][value=url]")).toBeChecked();
    await openApp(page, "/index.html");
    expect((await uiLanguage(page)).lang).toBe("en");
  });

  test("a manual choice is remembered after reload", async ({ guarded: page }) => {
    await openApp(page);
    await page.click("#langBtn");
    await page.click(".lang-option[data-code=sv]");
    expect((await uiLanguage(page)).lang).toBe("sv");
    await page.reload();
    await page.waitForFunction(() => !!currentQR);
    expect((await uiLanguage(page)).lang).toBe("sv");
    expect(await page.evaluate(() => localStorage.getItem("offline-qr-tools.lang"))).toBe("sv");
  });

  test("an invalid ?lang value is ignored", async ({ guarded: page }) => {
    await openApp(page, "/index.html?lang=<script>alert(1)</script>");
    expect((await uiLanguage(page)).lang).toBe("en");
  });
});

test.describe("computer set to an unsupported language (German)", () => {
  test.use({ locale: "de-DE" });

  test("falls back to English", async ({ guarded: page }) => {
    await openApp(page);
    expect((await uiLanguage(page)).lang).toBe("en");
  });
});

test.describe("computer set to Swedish", () => {
  test.use({ locale: "sv-SE" });

  test("opens in Swedish", async ({ guarded: page }) => {
    await openApp(page);
    const ui = await uiLanguage(page);
    expect(ui.lang).toBe("sv");
    expect(ui.ssidLabel).toBe("Nätverksnamn (SSID)");
  });
});
