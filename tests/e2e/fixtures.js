"use strict";

// Shared fixture: every test runs inside guards that fail it if the page makes a network
// request to anything but the local test server, violates the CSP, or logs an error.
const base = require("@playwright/test");
const zlib = require("node:zlib");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const LOCAL = /^(http:\/\/127\.0\.0\.1:4173\/|file:|data:|blob:)/;

// Installs the guards on a page and returns a function that asserts nothing went wrong.
// CSP violations are reported through an exposed binding, which survives navigations
// (a window variable would be reset by every page load).
async function installGuards(page) {
  const external = [];
  const errors = [];
  const csp = [];
  await page.exposeBinding("__reportCspViolation", (source, text) => { csp.push(text); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__reportCspViolation(e.violatedDirective + " " + (e.blockedURI || ""));
    });
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (LOCAL.test(url)) return route.continue();
    external.push(url);
    return route.abort();
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("crash", () => errors.push("page crashed"));

  return function verify() {
    base.expect(external, "network requests to external hosts").toEqual([]);
    base.expect(csp, "Content-Security-Policy violations").toEqual([]);
    base.expect(errors, "console / page errors").toEqual([]);
  };
}

const test = base.test.extend({
  guarded: async ({ page }, use) => {
    const verify = await installGuards(page);
    await use(page);
    verify();
  }
});

async function openApp(page, url) {
  await page.goto(url || "/index.html");
  await page.waitForFunction(() => typeof updatePreview === "function" && !!currentQR);
}

async function openAllSections(page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => { d.open = true; });
    $("#printSection").trigger("toggle");
  });
}

async function enterNetwork(page, ssid, password) {
  await page.fill("#ssid", ssid);
  if (password !== undefined) await page.fill("#pswd", password);
  await waitForScan(page);
}

// Waits until the debounced preview and the scan self-test have settled.
async function waitForScan(page) {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => {
    const s = $("#scanStatus").attr("data-state");
    return $("#scanStatus").is("[hidden]") || (s && s !== "checking");
  });
}

// Decodes a PNG (Buffer) inside the page with the vendored jsQR; returns the text or null.
async function decodePng(page, buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, d.width, d.height);
    return r ? new TextDecoder().decode(new Uint8Array(r.binaryData)) : null;
  }, buffer.toString("base64"));
}

// All text a PDF viewer could show: raw file plus every inflated content stream (latin1).
function pdfSearchableText(buffer) {
  const raw = buffer.toString("latin1");
  let out = raw;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    for (const candidate of [chunk, chunk.subarray(0, Math.max(0, chunk.length - 1)), chunk.subarray(0, Math.max(0, chunk.length - 2))]) {
      try { out += "\n" + zlib.inflateSync(candidate).toString("latin1"); break; } catch (e) { /* not deflated */ }
    }
  }
  return out;
}

async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const fs = require("node:fs");
  return { name: dl.suggestedFilename(), data: fs.readFileSync(await dl.path()) };
}

module.exports = { test, expect: base.expect, ROOT, installGuards, openApp, openAllSections, enterNetwork, waitForScan, decodePng, pdfSearchableText, download };
