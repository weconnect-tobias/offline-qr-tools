"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadScripts } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js", "js/core/payload.js", "js/core/password.js"]);
const generateWifiPassword = get("generateWifiPassword");
const ALPHABET = get("PASSWORD_ALPHABET");
const validatePassword = get("validatePassword");
const secureBytes = (n) => new Uint8Array(crypto.randomBytes(n));

test("format: 4 groups of 5 characters without look-alikes, valid for WPA", () => {
  for (let i = 0; i < 200; i++) {
    const p = generateWifiPassword(secureBytes);
    assert.match(p, /^[a-km-np-zA-HJ-NP-Z2-9]{5}(-[a-km-np-zA-HJ-NP-Z2-9]{5}){3}$/);
    assert.doesNotMatch(p, /[0O1lIo]/);
    assert.equal(validatePassword("WPA", p), null, p);
  }
});

test("the alphabet has 56 unique characters (116 bits for 20 characters)", () => {
  assert.equal(new Set(ALPHABET).size, ALPHABET.length);
  assert.equal(ALPHABET.length, 56);
  assert.ok(20 * Math.log2(ALPHABET.length) > 115);
});

test("bytes that would bias the result are skipped (rejection sampling)", () => {
  // 224..255 must be ignored: a source that only returns 255 then 0 must yield only "a".
  let call = 0;
  const p = generateWifiPassword((n) => new Uint8Array(n).fill(call++ % 2 === 0 ? 255 : 0));
  assert.equal(p, "aaaaa-aaaaa-aaaaa-aaaaa");
});

test("every character is used and none is strongly favoured", () => {
  const counts = new Map();
  for (let i = 0; i < 3000; i++) for (const c of generateWifiPassword(secureBytes).replace(/-/g, "")) counts.set(c, (counts.get(c) || 0) + 1);
  assert.equal(counts.size, ALPHABET.length);
  const expected = 3000 * 20 / ALPHABET.length; // ~1071
  for (const [c, n] of counts) assert.ok(Math.abs(n - expected) < expected * 0.2, `${c}: ${n}`);
});

test("the UI uses crypto.getRandomValues, never Math.random, for passwords", () => {
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  assert.match(app, /generateWifiPassword\(function\(n\) \{ return window\.crypto\.getRandomValues/);
  const code = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const f of ["js/core/password.js", "js/app.js"]) assert.doesNotMatch(code(f), /Math\.random/, f);
});
