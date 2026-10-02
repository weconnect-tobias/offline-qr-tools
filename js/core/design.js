"use strict";

/* =========================================================================
 * Design files (pure — no DOM, no jQuery)
 *
 * A design file stores how a QR code looks, so a person or a company can reuse it:
 *   { "format": "offline-qr-tools/design", "version": 1, "style": { … }, "logo": "data:image/png;base64,…" }
 *
 * SECURITY
 * - Only appearance is stored. Content is never written: no SSID, password, URL, contact
 *   details, and no heading or caption text either (a user may have typed a secret there;
 *   see checkPasswordInText() in app.js). A design file can be shared without leaking anything.
 * - Imported files are untrusted. Every field is validated against DESIGN_FIELDS; enums are
 *   checked against the options that actually exist in the UI; unknown keys are ignored;
 *   nothing is ever evaluated. The logo must be a base64 PNG and is passed through the same
 *   hardened pipeline as an uploaded logo (js/ui/logo.js) before use.
 *
 * Keys are the ids of the form controls they belong to.
 * Depends on: nothing.
 * ========================================================================= */

const DESIGN_FORMAT = "offline-qr-tools/design";
const DESIGN_VERSION = 1;
const DESIGN_MAX_FILE_BYTES = 3 * 1024 * 1024 + 512 * 1024; // a 2 MB logo is ~2.7 MB as base64
const DESIGN_LOGO_MAX_BYTES = 2 * 1024 * 1024;              // same cap as an uploaded logo
const DESIGN_LOGO_PREFIX = "data:image/png;base64,";

const DESIGN_FIELDS = {
  qrShape: { kind: "enum" },
  eyeStyle: { kind: "enum" },
  qrColor: { kind: "hex" },
  qrBgColor: { kind: "hex" },
  gradient: { kind: "enum" },
  gradientAngle: { kind: "int", min: 0, max: 355 },
  gradientColor2: { kind: "hex" },
  customEyeColor: { kind: "bool" },
  eyeColor: { kind: "hex" },
  logoSize: { kind: "int", min: 10, max: 30 },
  logoBackground: { kind: "enum" },
  frameStyle: { kind: "enum" },
  frameColor: { kind: "hex" },
  textStyle: { kind: "enum" },
  textBgColor: { kind: "hex" },
  textSize: { kind: "enum" },
  autoTextColor: { kind: "bool" },
  textColor: { kind: "hex" },
  wifiIcon: { kind: "bool" },
  ecLevel: { kind: "enum" },
  quietZone: { kind: "enum" },
  transparentBg: { kind: "bool" }
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Returns the cleaned value, or undefined when the value is not acceptable.
function validateDesignValue(field, value, allowed) {
  switch (field.kind) {
    case "hex":
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : undefined;
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "int":
      return Number.isInteger(value) && value >= field.min && value <= field.max ? value : undefined;
    case "enum":
      return typeof value === "string" && Array.isArray(allowed) && allowed.indexOf(value) >= 0 ? value : undefined;
    default:
      return undefined;
  }
}

// Builds a design object from control values (already validated by the UI).
function buildDesign(values, logoDataUrl) {
  const style = {};
  Object.keys(DESIGN_FIELDS).forEach(function(key) {
    if (hasOwn(values, key)) style[key] = values[key];
  });
  const design = { format: DESIGN_FORMAT, version: DESIGN_VERSION, style: style };
  if (typeof logoDataUrl === "string" && logoDataUrl.indexOf(DESIGN_LOGO_PREFIX) === 0) design.logo = logoDataUrl;
  return design;
}

// Base64 → byte length without decoding; null when the string is not strict base64.
function base64ByteLength(b64) {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return b64.length / 4 * 3 - padding;
}

// Parses and validates a design file.
//   enumOptions: { key: [allowed values] } for every enum field (taken from the UI).
// Returns { style, logoBase64, skipped } or { error } (error = i18n key).
function parseDesignFile(text, enumOptions) {
  if (typeof text !== "string" || text.length > DESIGN_MAX_FILE_BYTES) return { error: "errDesignSize" };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "errDesignInvalid" };
  }
  if (!isPlainObject(data) || data.format !== DESIGN_FORMAT || !isPlainObject(data.style)) return { error: "errDesignInvalid" };
  if (data.version !== DESIGN_VERSION) return { error: "errDesignVersion" };

  const style = {};
  let skipped = 0;
  Object.keys(DESIGN_FIELDS).forEach(function(key) {
    if (!hasOwn(data.style, key)) return;
    const clean = validateDesignValue(DESIGN_FIELDS[key], data.style[key], (enumOptions || {})[key]);
    if (clean === undefined) skipped++;
    else style[key] = clean;
  });

  let logoBase64 = null;
  if (hasOwn(data, "logo")) {
    const logo = data.logo;
    const b64 = typeof logo === "string" && logo.indexOf(DESIGN_LOGO_PREFIX) === 0 ? logo.slice(DESIGN_LOGO_PREFIX.length) : null;
    const bytes = b64 === null ? null : base64ByteLength(b64);
    if (bytes === null || bytes === 0) return { error: "errDesignLogo" };
    if (bytes > DESIGN_LOGO_MAX_BYTES) return { error: "errDesignLogo" };
    logoBase64 = b64;
  }
  return { style: style, logoBase64: logoBase64, skipped: skipped };
}
