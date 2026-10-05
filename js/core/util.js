"use strict";

/* =========================================================================
 * Core utilities (pure — no DOM, no jQuery)
 *
 * Escaping, sanitizing, colour maths and small helpers. Safe to load in Node for unit tests.
 * ========================================================================= */

function escapeWifi(str) {
  return str.replace(/([\\;,:"])/g, "\\$1");
}

// Unpaired UTF-16 surrogates (e.g. half an emoji from a broken paste) cannot be encoded as
// UTF-8 and make encodeURIComponent throw. They are replaced by U+FFFD before any use.
function toWellFormed(str) {
  const s = String(str);
  if (!/[\uD800-\uDFFF]/.test(s)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
      out += s.charAt(i) + s.charAt(i + 1);
      i++;
    } else {
      out += c >= 0xD800 && c <= 0xDFFF ? "\uFFFD" : s.charAt(i);
    }
  }
  return out;
}

// Characters XML 1.0 does not allow at all (most C0 controls, U+FFFE/U+FFFF, lone surrogates)
// make an exported SVG unreadable, so they are removed rather than escaped.
function escapeXml(str) {
  return toWellFormed(str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;

// Every color that reaches a renderer passes through here. Values end up inside
// SVG attributes, so anything that isn't a strict #rrggbb is replaced by a fallback.
function sanitizeHex(value, fallback) {
  const v = String(value || "");
  return HEX_COLOR_RE.test(v) ? "#" + v.replace("#", "").toLowerCase() : fallback;
}

function isValidHex(hex) {
  return /^[0-9A-Fa-f]{6}$/.test(hex);
}

function hexToRgb(hex) {
  const h = sanitizeHex(hex, "#000000").slice(1);
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}

function relativeLuminance(hex) {
  const c = hexToRgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

function contrastTextColor(hex) {
  return relativeLuminance(hex) > 0.6 ? "#111111" : "#ffffff";
}

// amount < 0 darkens towards black, amount > 0 lightens towards white.
function shadeHex(hex, amount) {
  const c = hexToRgb(hex);
  const mix = function(v) {
    const out = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
    return Math.max(0, Math.min(255, Math.round(out))).toString(16).padStart(2, "0");
  };
  return "#" + mix(c.r) + mix(c.g) + mix(c.b);
}

// Rounds coordinates so SVG output stays compact and deterministic.
function f(n) {
  return Math.round(n * 100) / 100;
}

// Rounded rectangle as an SVG path. r is a number or [tl, tr, br, bl].
function roundRectD(x, y, w, h, r) {
  const radii = Array.isArray(r) ? r : [r, r, r, r];
  const max = Math.min(w, h) / 2;
  const tl = Math.max(0, Math.min(radii[0] || 0, max));
  const tr = Math.max(0, Math.min(radii[1] || 0, max));
  const br = Math.max(0, Math.min(radii[2] || 0, max));
  const bl = Math.max(0, Math.min(radii[3] || 0, max));
  const arc = function(rad, ex, ey) {
    return rad ? "A" + f(rad) + " " + f(rad) + " 0 0 1 " + f(ex) + " " + f(ey) : "";
  };
  return "M" + f(x + tl) + " " + f(y) +
    "H" + f(x + w - tr) + arc(tr, x + w, y + tr) +
    "V" + f(y + h - br) + arc(br, x + w - br, y + h) +
    "H" + f(x + bl) + arc(bl, x, y + h - bl) +
    "V" + f(y + tl) + arc(tl, x + tl, y) + "Z";
}

// .flush() runs a pending call at once (e.g. before a download, so it uses the latest input).
function debounce(fn, ms) {
  let timer = null;
  const debounced = function() {
    clearTimeout(timer);
    timer = setTimeout(function() { timer = null; fn(); }, ms);
  };
  debounced.flush = function() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn();
  };
  return debounced;
}

// 64-bit FNV-1a over UTF-16 code units, as 16 hex digits (an identifier, not a security hash).
function hashHex(text) {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}


// PDF standard fonts only cover Windows-1252. Text outside it (emoji, CJK, Polish ł …)
// must be rendered as an image instead of producing wrong glyphs.
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function isWinAnsi(text) {
  for (const ch of Array.from(text)) {
    const code = ch.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) continue;
    if (CP1252_EXTRA.indexOf(ch) >= 0) continue;
    return false;
  }
  return true;
}

// Picks the UI language. Priority: explicit link (?lang=xx) → the user's saved choice →
// the browser's preferred languages (en-GB matches en) → fallback. Only codes that have a
// loaded language file are ever returned, so no unvalidated value reaches the DOM.
function resolveLanguage(options) {
  const available = (options.available || []).map(function(c) { return String(c).toLowerCase(); });
  const pick = function(value) {
    if (typeof value !== "string") return null;
    const code = value.trim().toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code)) return null;
    if (available.indexOf(code) >= 0) return code;
    const primary = code.split("-")[0];
    return available.indexOf(primary) >= 0 ? primary : null;
  };
  const candidates = [options.urlLang, options.saved].concat(options.browser || []);
  for (let i = 0; i < candidates.length; i++) {
    const code = pick(candidates[i]);
    if (code) return code;
  }
  return available.indexOf(options.fallback) >= 0 ? options.fallback : available[0];
}
