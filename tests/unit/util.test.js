"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js"]);

test("sanitizeHex accepts only #rrggbb and normalises it", () => {
  const sanitizeHex = get("sanitizeHex");
  assert.equal(sanitizeHex("#A1B2C3", "#000000"), "#a1b2c3");
  assert.equal(sanitizeHex("a1b2c3", "#000000"), "#a1b2c3");
  for (const bad of ["red", "#fff", "#12345g", 'red" onload="alert(1)', "#123456;x", "", null, undefined]) {
    assert.equal(sanitizeHex(bad, "#000000"), "#000000", String(bad));
  }
});

test("escapeXml neutralises markup", () => {
  assert.equal(get("escapeXml")(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});

test("escapeXml drops characters XML 1.0 cannot hold, so an SVG export always parses", () => {
  const escapeXml = get("escapeXml");
  assert.equal(escapeXml("A\u0001B\u000bC\u000cD\uFFFE"), "ABCD");
  assert.equal(escapeXml("tab\tnew\nline"), "tab\tnew\nline", "tab and newline are allowed");
  assert.equal(escapeXml("x\uD800"), "x\uFFFD", "a lone surrogate becomes U+FFFD");
});

test("toWellFormed keeps pairs and replaces lone surrogates", () => {
  const toWellFormed = get("toWellFormed");
  assert.equal(toWellFormed("😀ab"), "😀ab");
  assert.equal(toWellFormed("\uDC00\uDC00"), "\uFFFD\uFFFD");
  assert.equal(toWellFormed("\uD800\uD83D\uDE00"), "\uFFFD😀");
});

test("debounce.flush runs a pending call at once, and only then", () => {
  let calls = 0;
  const d = get("debounce")(() => { calls++; }, 10000);
  d.flush();
  assert.equal(calls, 0, "nothing pending");
  d();
  d.flush();
  assert.equal(calls, 1);
  d.flush();
  assert.equal(calls, 1, "not twice");
});

test("escapeWifi escapes the five reserved characters", () => {
  assert.equal(get("escapeWifi")('\\;,:"'), '\\\\\\;\\,\\:\\"');
});

test("utf8ByteLength counts bytes", () => {
  const n = get("utf8ByteLength");
  assert.equal(n("abc"), 3);
  assert.equal(n("åäö"), 6);
  assert.equal(n("🍩"), 4);
});

test("contrast helpers", () => {
  assert.equal(get("contrastTextColor")("#ffffff"), "#111111");
  assert.equal(get("contrastTextColor")("#000000"), "#ffffff");
  assert.equal(get("shadeHex")("#808080", -0.5), "#404040");
});

test("isWinAnsi decides vector text vs image in PDFs", () => {
  const isWinAnsi = get("isWinAnsi");
  assert.equal(isWinAnsi("Kafé Åkerö – 1. Öppna"), true);
  assert.equal(isWinAnsi("Café 🍩"), false);
  assert.equal(isWinAnsi("Łódź"), false);
});

test("resolveLanguage: link → saved choice → browser languages → fallback", () => {
  const resolve = (o) => get("resolveLanguage")(Object.assign({ available: ["en", "sv"], fallback: "en" }, o));
  assert.equal(resolve({ browser: ["sv-SE", "en-US"] }), "sv");
  assert.equal(resolve({ browser: ["en-GB", "sv"] }), "en");
  assert.equal(resolve({ browser: ["de-DE", "sv"] }), "sv");     // first supported in the user's list
  assert.equal(resolve({ browser: ["de-DE", "fr"] }), "en");     // nothing supported → fallback
  assert.equal(resolve({ browser: [] }), "en");
  assert.equal(resolve({ saved: "sv", browser: ["en-US"] }), "sv");
  assert.equal(resolve({ urlLang: "en", saved: "sv", browser: ["sv"] }), "en");
  assert.equal(resolve({ urlLang: "SV-se", browser: ["en"] }), "sv"); // case-insensitive, region ignored
});

test("resolveLanguage ignores unknown or malformed codes", () => {
  const resolve = (o) => get("resolveLanguage")(Object.assign({ available: ["en", "sv"], fallback: "en" }, o));
  for (const bad of ["xx", "<script>", "en;sv", "../sv", "", null, 42]) {
    assert.equal(resolve({ urlLang: bad, saved: bad, browser: ["sv"] }), "sv", String(bad));
  }
  assert.equal(get("resolveLanguage")({ available: ["sv"], fallback: "en", browser: ["de"] }), "sv"); // fallback missing → first available
});
