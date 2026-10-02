"use strict";

// Static checks for the rules in AGENTS.md. They are intentionally strict: if one fails,
// read AGENTS.md before relaxing it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("../support/load-scripts");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("index.html");

function files(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []);
}
const appJs = files("js", ".js");
const appSources = appJs.concat(files("lang", ".js"), ["css/app.css", "index.html"]);

test("CSP meta forbids network access and inline code", () => {
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert.ok(csp, "CSP meta tag missing");
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(csp.includes(directive), `CSP lacks ${directive}`);
  }
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(csp), "CSP must not allow inline code, eval or remote hosts");
});

test("no inline scripts, <style> blocks or style attributes in index.html", () => {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc="/, "script without src");
    assert.equal(m[2].trim(), "", "inline script body");
  }
  assert.ok(!/<style\b/i.test(html), "<style> block found");
  assert.ok(!/\sstyle="/i.test(html), "style attribute found");
  assert.ok(!/\son[a-z]+="/i.test(html), "inline event handler found");
});

// Addresses that are only ever written INTO a QR code (never requested by the app; the CSP
// blocks all requests anyway). Each entry is limited to one file and must be justified.
const QR_PAYLOAD_URLS = {
  "js/core/qr-types.js": ["https://app.swish.nu/1/p/sw/"] // Swish payment link, same as Swish's own generator
};

test("no remote URLs in app code (only the SVG namespace and listed QR payload links)", () => {
  for (const f of appSources) {
    const allowed = QR_PAYLOAD_URLS[f.split(path.sep).join("/")] || [];
    const urls = [...read(f).matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0])
      .filter((u) => u !== "http://www.w3.org/2000/svg" && allowed.indexOf(u) < 0);
    assert.deepEqual(urls, [], f);
  }
});

test("QR payload links are only used as payload data, never fetched", () => {
  const src = read("js/core/qr-types.js");
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|import\()/.test(src));
  for (const list of Object.values(QR_PAYLOAD_URLS)) for (const u of list) assert.match(u, /^https:\/\/[a-z0-9.-]+\//);
});

test("no dangerous DOM / eval sinks in app code", () => {
  const banned = [/\.innerHTML\b/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function\(/, /\.html\(/, /\.append\(\s*["'`][^"'`]*\$\{/];
  for (const f of appJs) {
    const src = read(f);
    for (const re of banned) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
});

test("no network APIs in app code", () => {
  for (const f of appJs) {
    const src = read(f);
    for (const re of [/\bfetch\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /new WebSocket/, /new EventSource/, /\bimportScripts\(/]) {
      assert.ok(!re.test(src), `${f} uses ${re}`);
    }
  }
});

test("the password field is only read by the payload/form code, never by print layouts", () => {
  const readers = appJs.filter((f) => read(f).includes('"#pswd"'));
  assert.deepEqual(readers.sort(), [path.join("js", "app.js"), path.join("js", "ui", "i18n.js")].sort());
  assert.ok(!/pswd|password/i.test(read("js/print-layouts.js").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
    "print-layouts.js must not touch the password (AGENTS.md rule 2)");
});

test("no console.log left in app code (it could leak the payload)", () => {
  for (const f of appJs) assert.ok(!/console\.log\(/.test(read(f)), f);
});

test("logo upload only accepts PNG/JPEG", () => {
  assert.match(html, /id="logoFile" accept="image\/png,image\/jpeg"/);
  assert.ok(!/svg\+xml/.test(read("js/ui/logo.js")));
});

test("localStorage is only used for the language choice (never form content)", () => {
  for (const f of appJs) {
    const uses = (read(f).match(/localStorage\.setItem\([^)]*\)/g) || []);
    for (const u of uses) assert.match(u, /^localStorage\.setItem\(LANG_STORAGE_KEY, code\)$/, `${f}: ${u}`);
  }
  assert.ok(!appJs.some((f) => /sessionStorage|indexedDB|document\.cookie/.test(read(f))), "no other storage APIs");
});

// jQuery 4 removed these helpers; using one only fails at run time in the browser.
test("no jQuery helpers that were removed in jQuery 4", () => {
  const removed = /\$\.(trim|isArray|isFunction|isNumeric|isWindow|type|parseJSON|nodeName|camelCase|now|proxy|unique|holdReady)\(/;
  for (const f of appJs) assert.ok(!removed.test(read(f)), f);
});
