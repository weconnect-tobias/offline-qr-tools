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
