"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts, plain } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js", "js/render/shapes.js"]);
const MODULE_SHAPES = get("MODULE_SHAPES");
const EYE_FRAME_SHAPES = get("EYE_FRAME_SHAPES");
const EYE_BALL_SHAPES = get("EYE_BALL_SHAPES");
const EYE_STYLES = get("EYE_STYLES");
const GRADIENT_TYPES = get("GRADIENT_TYPES");
const eyesPathD = get("eyesPathD");
const qrPaint = get("qrPaint");
const ALIGNMENT_POSITIONS = get("ALIGNMENT_POSITIONS");
const isStructuralModule = get("isStructuralModule");
const normalizeAngle = get("normalizeAngle");

const langFiles = fs.readdirSync(path.join(ROOT, "lang")).filter((f) => f.endsWith(".js"));
const I18N = loadScripts(langFiles.map((f) => "lang/" + f))("I18N");

// Only move, line, arc, cubic-curve and close commands with numbers: nothing that
// could break out of an SVG attribute.
const PATH_RE = /^[MmLlHhVvAaCcZz0-9 .\-]*$/;

// 21×21 test matrix with a checkerboard of data modules.
const N = 21;
const isDark = (r, c) => r >= 0 && c >= 0 && r < N && c < N && (r + c) % 2 === 0;

const registries = { MODULE_SHAPES, EYE_STYLES };

test("every registry has a square default and a label in every language", () => {
  for (const [name, registry] of Object.entries(registries)) {
    assert.ok(registry.square, name + ".square");
    for (const [id, entry] of Object.entries(registry)) {
      assert.match(id, /^[a-z][A-Za-z]*$/, name + " id");
      for (const code of Object.keys(I18N)) assert.ok(I18N[code][entry.labelKey], `${code}.${entry.labelKey} (${name}.${id})`);
    }
  }
});

test("module shapes produce safe, non-empty path data", () => {
  for (const [id, shape] of Object.entries(MODULE_SHAPES)) {
    const d = shape.pathD(isDark, N, 10, 10, 4);
    assert.ok(d.length > 0, id);
    assert.match(d, PATH_RE, id);
    assert.doesNotMatch(d, /NaN|Infinity|undefined/, id);
  }
});

test("module shapes draw nothing for an empty matrix", () => {
  for (const [id, shape] of Object.entries(MODULE_SHAPES)) assert.equal(shape.pathD(() => false, N, 0, 0, 4), "", id);
});

test("every eye style points at an existing frame and centre and produces safe path data", () => {
  for (const [id, style] of Object.entries(EYE_STYLES)) {
    assert.equal(typeof EYE_FRAME_SHAPES[style.frame], "function", id + ".frame");
    assert.equal(typeof EYE_BALL_SHAPES[style.ball], "function", id + ".ball");
    const d = eyesPathD(N, 0, 0, 4, id);
    assert.match(d, PATH_RE, id);
    assert.doesNotMatch(d, /NaN|undefined/, id);
  }
});

test("unknown eye styles fall back to square (no prototype lookups)", () => {
  const square = eyesPathD(N, 0, 0, 4, "square");
  for (const bad of ["<script>", "constructor", "__proto__", "toString", undefined]) assert.equal(eyesPathD(N, 0, 0, 4, bad), square, String(bad));
});

test("qrPaint returns a flat colour or a gradient spanning the code", () => {
  const base = { qrColor: "#000000", gradientColor2: "#1e3a8a" };
  assert.equal(qrPaint(Object.assign({ gradient: "none" }, base), 0, 0, 100), "#000000");
  assert.equal(qrPaint(Object.assign({ gradient: "bogus" }, base), 0, 0, 100), "#000000");
  assert.deepEqual(plain(qrPaint(Object.assign({ gradient: "vertical" }, base), 10, 20, 100)),
    { gradient: "linear", x1: 10, y1: 20, x2: 10, y2: 120, stops: ["#000000", "#1e3a8a"] });
  const radial = plain(qrPaint(Object.assign({ gradient: "radial" }, base), 0, 0, 100));
  assert.equal(radial.gradient, "radial");
  assert.equal(radial.cx, 50);
  for (const type of GRADIENT_TYPES.slice(1)) assert.equal(typeof qrPaint(Object.assign({ gradient: type }, base), 0, 0, 100), "object", type);
});

test("the alignment table matches the vendored qrcode-generator", () => {
  const dir = path.join(ROOT, "vendor/qrcode-generator");
  const file = fs.readdirSync(dir).find((f) => /^qrcode.*\.js$/.test(f));
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  const m = src.match(/PATTERN_POSITION_TABLE = (\[[\s\S]*?\]);/);
  assert.ok(m, "table found in vendor file");
  assert.deepEqual(plain(ALIGNMENT_POSITIONS), JSON.parse(m[1]));
});

test("structural modules: finders with separators, timing and alignment patterns are protected", () => {
  const n = 45; // version 7: alignment centres 6, 22, 38
  assert.ok(isStructuralModule(7, 7, n), "finder separator");
  assert.ok(isStructuralModule(6, 20, n) && isStructuralModule(20, 6, n), "timing patterns");
  assert.ok(isStructuralModule(22, 22, n) && isStructuralModule(20, 24, n), "central alignment pattern");
  assert.ok(isStructuralModule(38, 38, n), "bottom-right alignment pattern");
  assert.ok(!isStructuralModule(19, 19, n) && !isStructuralModule(30, 30, n), "ordinary data modules");
  assert.ok(!isStructuralModule(10, 10, 21), "version 1 has no alignment pattern");
});

test("custom gradient angles: normalised, and the gradient runs through the centre", () => {
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle("abc"), 45);
  assert.equal(normalizeAngle("1e999"), 45);
  const base = { qrColor: "#000000", gradientColor2: "#1e3a8a", gradient: "angle" };
  const right = plain(qrPaint(Object.assign({ gradientAngle: 0 }, base), 0, 0, 100));
  assert.deepEqual([right.x1, right.y1, right.x2, right.y2], [0, 50, 100, 50]);
  const down = plain(qrPaint(Object.assign({ gradientAngle: 90 }, base), 0, 0, 100));
  assert.ok(Math.abs(down.x1 - 50) < 1e-9 && Math.abs(down.y1) < 1e-9 && Math.abs(down.y2 - 100) < 1e-9);
  const diag = plain(qrPaint(Object.assign({ gradientAngle: 45 }, base), 0, 0, 100));
  assert.ok(Math.abs(diag.x1) < 1e-9 && Math.abs(diag.y2 - 100) < 1e-9, "45° reaches the corners");
});
