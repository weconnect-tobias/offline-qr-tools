"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts } = require("../support/load-scripts");

const langFiles = fs.readdirSync(path.join(ROOT, "lang")).filter((f) => f.endsWith(".js"));
const get = loadScripts(langFiles.map((f) => "lang/" + f));
const I18N = get("I18N");
const codes = Object.keys(I18N);

function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
}

test("every language defines exactly the same keys", () => {
  const reference = Object.keys(I18N.sv).sort();
  for (const code of codes) {
    assert.deepEqual(Object.keys(I18N[code]).sort(), reference, `lang/${code}.js`);
  }
});

test("no translation is empty; langName and flagCode are set", () => {
  for (const code of codes) {
    for (const [key, value] of Object.entries(I18N[code])) assert.ok(String(value).trim(), `${code}.${key} is empty`);
    assert.match(I18N[code].flagCode, /^[a-z]{2}$/, `${code}.flagCode`);
    assert.ok(fs.existsSync(path.join(ROOT, "assets/flags", I18N[code].flagCode + ".svg")), `flag for ${code}`);
  }
});

test("every key referenced in index.html and JS exists", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const used = new Set([...html.matchAll(/data-i18n(?:-placeholder)?="([A-Za-z0-9]+)"/g)].map((m) => m[1]));
  for (const file of jsFiles("js")) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/\bt\("([A-Za-z0-9]+)"\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/(?:showMessage\([^,]+,\s*|rejectLogo\(|setScanStatus\("[a-z]+",\s*)"([A-Za-z0-9]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in I18N.sv));
  assert.deepEqual(missing, []);
});
