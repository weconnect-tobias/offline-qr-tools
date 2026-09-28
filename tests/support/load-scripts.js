"use strict";

// Loads the app's classic browser scripts into an isolated Node VM context so that pure
// modules (js/core/*) can be unit-tested without a browser. Top-level declarations
// (function, const, let) become visible to later scripts in the same context, exactly
// like <script> tags sharing one page.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

function loadScripts(files, globals) {
  const context = vm.createContext(Object.assign({ console, TextEncoder, setTimeout, clearTimeout }, globals || {}));
  context.window = context; // browser scripts use window.X for globals (e.g. lang files)
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  // Lexical declarations are not properties of the global object; evaluate names inside the context.
  return function get(name) {
    return vm.runInContext(name, context);
  };
}

// Objects created inside the VM have that realm's prototypes; strict deep equality in the
// test realm needs plain copies.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { ROOT, loadScripts, plain };
