"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts } = require("../support/load-scripts");

const SWISH_SYMBOLS = loadScripts(["js/assets/swish-symbols.js"])("SWISH_SYMBOLS");

const FILES = { color: "assets/swish/swish-symbol.svg", grayscale: "assets/swish/swish-symbol-grayscale.svg" };

test("the embedded Swish symbols match the SVG files", () => {
  for (const [key, file] of Object.entries(FILES)) {
    const expected = "data:image/svg+xml;base64," + fs.readFileSync(path.join(ROOT, file)).toString("base64");
    assert.equal(SWISH_SYMBOLS[key], expected, key);
  }
});

test("the Swish SVGs contain artwork only: no scripts, events, external references or metadata", () => {
  for (const file of Object.values(FILES)) {
    const svg = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(svg, /<script|\son[a-z]+=|<foreignObject|<image|<!--|<title|<desc|<metadata/i, file);
    // Only internal references (#id) and the two XML namespaces.
    for (const m of svg.matchAll(/(?:href|src)="([^"]*)"/g)) assert.match(m[1], /^#/, file);
    const urls = [...svg.matchAll(/https?:\/\/[^\s"]+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(urls)].sort(), ["http://www.w3.org/1999/xlink", "http://www.w3.org/2000/svg"], file);
  }
});

test("the grayscale symbol has no colour left and the same shapes as the colour one", () => {
  const color = fs.readFileSync(path.join(ROOT, FILES.color), "utf8");
  const gray = fs.readFileSync(path.join(ROOT, FILES.grayscale), "utf8");
  for (const m of gray.matchAll(/stop-color="#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})"/gi)) {
    assert.ok(m[1] === m[2] && m[2] === m[3], "grey stop " + m[0]);
  }
  const shapes = (s) => s.replace(/stop-color="#[0-9A-F]{6}"/gi, "");
  assert.equal(shapes(gray), shapes(color));
});

test("the trademark notice exists and excludes the files from the MIT license", () => {
  const notice = fs.readFileSync(path.join(ROOT, "assets/swish/NOTICE.md"), "utf8");
  assert.match(notice, /Getswish AB/);
  assert.match(notice, /not\*\* covered by this project's MIT license/);
});
