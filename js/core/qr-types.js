"use strict";

/* =========================================================================
 * QR content types (pure — no DOM, no jQuery)
 *
 * Every type turns form input into the exact text encoded in the QR code:
 *   buildQrPayload(type, input) ->
 *     { payload, summary, warning? }        success
 *     { error, visible? }                   error = i18n key; visible = show it to the user
 *                                           (missing fields are silent: the form is just not filled in yet)
 * `summary` is a short human-readable description used for captions and print layouts.
 * SECURITY: a summary must never contain a secret (the Wi-Fi summary is the SSID only).
 *
 * To add a type: add a builder to QR_TYPES, a panel in index.html, a reader in app.js,
 * i18n keys in every lang/*.js file and unit tests in tests/unit/qr-types.test.js.
 *
 * Depends on: core/util.js, core/payload.js (Wi-Fi), the URL global (browser and Node).
 * ========================================================================= */

// Version 40 at error correction H holds 1273 bytes; leave room so logos still fit.
const QR_TEXT_MAX_BYTES = 1000;
const URL_MAX_LENGTH = 2000;
const ALLOWED_URL_PROTOCOLS = ["http:", "https:"];

// Pragmatic address check: one "@", no whitespace, no characters that could add
// mailto: parameters (? & ,) or break the URI.
const EMAIL_RE = /^[^\s@?&,;:<>()[\]\\"]+@[^\s@?&,;:<>()[\]\\"]+\.[^\s@?&,;:<>()[\]\\".]{2,}$/;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function tooLong(text) {
  return utf8ByteLength(text) > QR_TEXT_MAX_BYTES;
}

/* ---- URL --------------------------------------------------------------- */

// Returns { url } with a normalised href, or { error }. Shared by the URL type and vCard.
function parseWebUrl(raw) {
  let text = clean(raw);
  if (!text) return { error: "empty" };
  if (text.length > URL_MAX_LENGTH) return { error: "errUrlTooLong" };
  // "example.com/menu" gets the https scheme prepended. Anything that already has a scheme is
  // parsed as-is, so "javascript:…" is rejected below instead of being "fixed".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch (e) {
    return { error: "errUrlInvalid" };
  }
  if (ALLOWED_URL_PROTOCOLS.indexOf(url.protocol) < 0) return { error: "errUrlScheme" };
  if (!url.hostname || url.hostname.indexOf(".") < 0 && url.hostname !== "localhost") return { error: "errUrlInvalid" };
  // user:password@host is a classic phishing disguise ("bank.example@evil.example" opens evil.example).
  if (url.username || url.password) return { error: "errUrlCredentials" };
  return { url: url };
}

function buildUrl(input) {
  const r = parseWebUrl(input.url);
  if (r.error === "empty") return { error: "url" };
  if (r.error) return { error: r.error, visible: true };
  const url = r.url;
  let warning = null;
  // Punycode hosts can imitate other domains (homograph attacks); plain http is readable
  // and modifiable on the network. Both are allowed but flagged.
  if (url.hostname.split(".").some(function(label) { return label.indexOf("xn--") === 0; })) warning = "warnUrlPunycode";
  else if (url.protocol === "http:") warning = "warnUrlHttp";
  const summary = url.hostname + (url.pathname === "/" ? "" : url.pathname);
  return { payload: url.href, summary: summary, warning: warning };
}

/* ---- Plain text -------------------------------------------------------- */

function buildText(input) {
  const text = String(input.text == null ? "" : input.text).replace(/\r\n?/g, "\n");
  if (!text.trim()) return { error: "text" };
  if (tooLong(text)) return { error: "errTextTooLong", visible: true };
  const firstLine = text.trim().split("\n")[0];
  return { payload: text, summary: firstLine.length > 40 ? firstLine.slice(0, 39) + "…" : firstLine };
}

/* ---- E-mail ------------------------------------------------------------ */

function buildEmail(input) {
  const to = clean(input.to);
  if (!to) return { error: "email" };
  if (!EMAIL_RE.test(to)) return { error: "errEmailInvalid", visible: true };
  const params = [];
  const subject = clean(input.subject);
  const body = String(input.body == null ? "" : input.body).replace(/\r\n?/g, "\n");
  // encodeURIComponent turns CR/LF, "&" and "?" into %xx, so subject/body cannot inject
  // extra headers such as cc/bcc.
  if (subject) params.push("subject=" + encodeURIComponent(subject));
  if (body.trim()) params.push("body=" + encodeURIComponent(body));
  const payload = "mailto:" + to + (params.length ? "?" + params.join("&") : "");
  if (tooLong(payload)) return { error: "errTextTooLong", visible: true };
  return { payload: payload, summary: to };
}

/* ---- Phone and SMS ----------------------------------------------------- */

// Keeps a leading "+" and digits; spaces, dashes, dots and brackets are formatting only.
function normalizePhone(raw) {
  const text = clean(raw);
  if (!text) return { error: "empty" };
  if (!/^\+?[\d\s\-().]+$/.test(text)) return { error: "invalid" };
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < 3 || digits.length > 20) return { error: "invalid" };
  return { number: (text.charAt(0) === "+" ? "+" : "") + digits };
}

function buildPhone(input) {
  const r = normalizePhone(input.number);
  if (r.error === "empty") return { error: "phone" };
  if (r.error) return { error: "errPhoneInvalid", visible: true };
  return { payload: "tel:" + r.number, summary: r.number };
}

function buildSms(input) {
  const r = normalizePhone(input.number);
  if (r.error === "empty") return { error: "sms" };
  if (r.error) return { error: "errPhoneInvalid", visible: true };
  const message = String(input.message == null ? "" : input.message).replace(/\r\n?/g, "\n");
  // SMSTO:<number>:<message> is understood by the built-in scanners on iOS and Android.
  const payload = "SMSTO:" + r.number + ":" + message;
  if (tooLong(payload)) return { error: "errTextTooLong", visible: true };
  return { payload: payload, summary: r.number };
}

/* ---- Contact (vCard 3.0) ----------------------------------------------- */

// RFC 2426 text escaping. Newlines are escaped too, so no value can start a new property
// (e.g. "Anna\nEND:VCARD\nBEGIN:VCARD…").
function escapeVcard(value) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\r\n?|\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

function buildVcard(input) {
  const first = clean(input.firstName), last = clean(input.lastName), org = clean(input.org);
  if (!first && !last && !org) return { error: "vcard" };

  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const fullName = [first, last].filter(Boolean).join(" ") || org;
  lines.push("N:" + escapeVcard(last) + ";" + escapeVcard(first) + ";;;");
  lines.push("FN:" + escapeVcard(fullName));
  if (org) lines.push("ORG:" + escapeVcard(org));
  if (clean(input.title)) lines.push("TITLE:" + escapeVcard(input.title));

  if (clean(input.phone)) {
    const p = normalizePhone(input.phone);
    if (p.error) return { error: "errPhoneInvalid", visible: true };
    lines.push("TEL;TYPE=CELL:" + p.number);
  }
  if (clean(input.email)) {
    if (!EMAIL_RE.test(clean(input.email))) return { error: "errEmailInvalid", visible: true };
    lines.push("EMAIL:" + clean(input.email));
  }
  if (clean(input.url)) {
    const u = parseWebUrl(input.url);
    if (u.error) return { error: u.error === "empty" ? "errUrlInvalid" : u.error, visible: true };
    lines.push("URL:" + escapeVcard(u.url.href));
  }
  const adr = [input.street, input.city, input.zip, input.country].map(clean);
  if (adr.some(Boolean)) {
    // ADR: post-office box; extended; street; locality; region; postal code; country
    lines.push("ADR;TYPE=WORK:;;" + escapeVcard(adr[0]) + ";" + escapeVcard(adr[1]) + ";;" + escapeVcard(adr[2]) + ";" + escapeVcard(adr[3]));
  }
  if (clean(input.note)) lines.push("NOTE:" + escapeVcard(input.note));
  lines.push("END:VCARD");

  const payload = lines.join("\r\n");
  if (tooLong(payload)) return { error: "errTextTooLong", visible: true };
  return { payload: payload, summary: fullName };
}

/* ---- Location ---------------------------------------------------------- */

function parseCoordinate(raw, limit) {
  const text = clean(raw).replace(",", ".");
  if (!/^[-+]?\d{1,3}(\.\d{1,8})?$/.test(text)) return null;
  const value = parseFloat(text);
  return Math.abs(value) <= limit ? value : null;
}

function buildGeo(input) {
  if (!clean(input.lat) && !clean(input.lon)) return { error: "geo" };
  const lat = parseCoordinate(input.lat, 90);
  const lon = parseCoordinate(input.lon, 180);
  if (lat === null || lon === null) return { error: "errGeoInvalid", visible: true };
  // geo: URI (RFC 5870) — opens the default maps app on both iOS and Android.
  const text = lat + "," + lon;
  return { payload: "geo:" + text, summary: text };
}

/* ---- Wi-Fi (rules live in core/payload.js) ----------------------------- */

function buildWifi(input) {
  const r = buildWifiPayload(input);
  if (r.error) return r;
  return { payload: r.payload, summary: r.ssid }; // SSID only — never the password
}

/* ---- Registry ---------------------------------------------------------- */

const QR_TYPES = {
  wifi: { build: buildWifi },
  url: { build: buildUrl },
  text: { build: buildText },
  email: { build: buildEmail },
  phone: { build: buildPhone },
  sms: { build: buildSms },
  vcard: { build: buildVcard },
  geo: { build: buildGeo }
};

const QR_TYPE_IDS = Object.keys(QR_TYPES);

function buildQrPayload(type, input) {
  const t = QR_TYPES[type];
  if (!t) return { error: "type" };
  return t.build(input || {});
}
