"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts, plain } = require("../support/load-scripts");

const get = loadScripts(["js/core/design.js"]);
const parseDesignFile = get("parseDesignFile");
const buildDesign = get("buildDesign");
const DESIGN_FIELDS = get("DESIGN_FIELDS");

const langFiles = fs.readdirSync(path.join(ROOT, "lang")).filter((f) => f.endsWith(".js"));
const I18N = loadScripts(langFiles.map((f) => "lang/" + f))("I18N");

const ENUMS = { qrShape: ["square", "dots"], eyeStyle: ["square", "circle"], frameStyle: ["none", "card"], gradient: ["none", "angle"],
  logoBackground: ["clear", "plate", "none"], textStyle: ["none", "plain", "banner"], textSize: ["0.8", "1.2"], ecLevel: ["auto", "H"], quietZone: ["2", "4", "6"] };
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function file(style, extra) {
  return JSON.stringify(Object.assign({ format: "offline-qr-tools/design", version: 1, style: style }, extra || {}));
}

test("a saved design opens again unchanged", () => {
  const values = { qrShape: "dots", eyeStyle: "circle", qrColor: "#112233", gradient: "angle", gradientAngle: 135,
    customEyeColor: true, logoSize: 25, quietZone: "2", transparentBg: false };
  const design = buildDesign(values, PNG_1PX);
  const r = parseDesignFile(JSON.stringify(design), ENUMS);
  assert.deepEqual(plain(r.style), values);
  assert.equal(r.skipped, 0);
  assert.equal(r.logoBase64, PNG_1PX.split(",")[1]);
});

test("content and texts are never written to a design file", () => {
  const design = buildDesign({ qrShape: "dots", ssid: "Home", pswd: "secret", titleText: "Wi-Fi", captionText: "pw: secret" }, null);
  const json = JSON.stringify(design);
  for (const word of ["ssid", "pswd", "secret", "titleText", "captionText", "Home"]) assert.ok(!json.includes(word), word);
  for (const key of Object.keys(DESIGN_FIELDS)) assert.doesNotMatch(key, /ssid|pswd|password|identity|url|email|phone|text$|caption|title|vc/i, key);
});

test("invalid values are skipped, unknown keys ignored", () => {
  const r = parseDesignFile(file({
    qrShape: "<img src=x onerror=alert(1)>", qrColor: "red\" onload=\"x", qrBgColor: "#ABCDEF", gradientAngle: 361,
    logoSize: 25.5, customEyeColor: "true", frameStyle: "card", evil: "x", quietZone: 4
  }), ENUMS);
  assert.deepEqual(plain(r.style), { qrBgColor: "#abcdef", frameStyle: "card" });
  assert.equal(r.skipped, 6);
});

test("prototype pollution keys have no effect", () => {
  const r = parseDesignFile('{"format":"offline-qr-tools/design","version":1,"style":{"__proto__":{"polluted":1},"constructor":{"x":1},"qrShape":"dots"}}', ENUMS);
  assert.deepEqual(plain(r.style), { qrShape: "dots" });
  assert.equal({}.polluted, undefined);
});

test("wrong format, version, size and broken JSON are rejected", () => {
  assert.equal(parseDesignFile("not json", ENUMS).error, "errDesignInvalid");
  assert.equal(parseDesignFile("[]", ENUMS).error, "errDesignInvalid");
  assert.equal(parseDesignFile(JSON.stringify({ format: "other", version: 1, style: {} }), ENUMS).error, "errDesignInvalid");
  assert.equal(parseDesignFile(JSON.stringify({ format: "offline-qr-tools/design", version: 1, style: [] }), ENUMS).error, "errDesignInvalid");
  assert.equal(parseDesignFile(file({}, { version: 2 }), ENUMS).error, "errDesignVersion");
  assert.equal(parseDesignFile("x".repeat(4 * 1024 * 1024), ENUMS).error, "errDesignSize");
});

test("only a base64 PNG logo within the size cap is accepted", () => {
  assert.equal(parseDesignFile(file({}, { logo: "data:image/svg+xml;base64,PHN2Zz4=" }), ENUMS).error, "errDesignLogo");
  assert.equal(parseDesignFile(file({}, { logo: "data:image/png;base64,not base64!" }), ENUMS).error, "errDesignLogo");
  assert.equal(parseDesignFile(file({}, { logo: "javascript:alert(1)" }), ENUMS).error, "errDesignLogo");
  assert.equal(parseDesignFile(file({}, { logo: 42 }), ENUMS).error, "errDesignLogo");
  const huge = "data:image/png;base64," + "A".repeat(Math.ceil(2.1 * 1024 * 1024 / 3) * 4);
  assert.equal(parseDesignFile(file({}, { logo: huge }), ENUMS).error, "errDesignLogo");
  assert.ok(parseDesignFile(file({}, { logo: PNG_1PX }), ENUMS).logoBase64);
});

test("every message key used by design files exists in every language", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/core/design.js"), "utf8");
  const keys = [...new Set([...src.matchAll(/"(errDesign[A-Za-z]+)"/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 4);
  for (const code of Object.keys(I18N)) for (const key of keys) assert.ok(I18N[code][key], `${code}.${key}`);
});

test("every design field is a control in index.html", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const key of Object.keys(DESIGN_FIELDS)) assert.match(html, new RegExp('id="' + key + '"'), key);
});

test("design code never reads content fields (static check)", () => {
  for (const file of ["js/core/design.js", "js/ui/design-file.js"]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const id of ["#pswd", "#ssid", "#identity", "#titleText", "#captionText", "currentPayload", "currentSummary", "localStorage"]) {
      assert.ok(!src.includes(id), `${file} must not use ${id}`);
    }
  }
});
