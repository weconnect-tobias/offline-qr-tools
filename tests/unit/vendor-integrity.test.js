"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ROOT } = require("../support/load-scripts");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "vendor/manifest.json"), "utf8"));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

for (const dep of manifest.dependencies) {
  test(`vendor/${dep.file} matches its SHA-384 in manifest.json`, () => {
    const data = fs.readFileSync(path.join(ROOT, "vendor", dep.file));
    assert.equal(crypto.createHash("sha384").update(data).digest("base64"), dep.sha384);
  });
  test(`index.html loads vendor/${dep.file}`, () => {
    assert.ok(html.includes(`<script src="vendor/${dep.file}"></script>`));
  });
}

test("index.html loads no vendor file that is missing from the manifest", () => {
  const known = new Set(manifest.dependencies.map((d) => "vendor/" + d.file));
  for (const m of html.matchAll(/<script src="(vendor\/[^"]+)"/g)) assert.ok(known.has(m[1]), m[1]);
});
