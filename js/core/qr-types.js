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
// mailto: parameters (? & ,), start a fragment (#), be percent-decoded by the mail app (%)
// or break the URI.
const EMAIL_RE = /^[^\s@?&,;:<>()[\]\\"#%]+@[^\s@?&,;:<>()[\]\\"#%]+\.[^\s@?&,;:<>()[\]\\".#%]{2,}$/;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function tooLong(text) {
  return utf8ByteLength(text) > QR_TEXT_MAX_BYTES;
}

// Shortens to at most `max` characters (code points, so an emoji is never cut in half).
function shorten(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/* ---- URL --------------------------------------------------------------- */

// Returns { url } with a normalised href, or { error }. Shared by the URL type and vCard.
function parseWebUrl(raw) {
  let text = clean(raw);
  if (!text) return { error: "empty" };
  if (text.length > URL_MAX_LENGTH) return { error: "errUrlTooLong" };
  // "example.com/menu" gets the https scheme prepended. Anything that already has a scheme is
  // parsed as-is, so "javascript:…" is rejected below instead of being "fixed". A host with a
  // port ("example.com:8080/menu", "localhost:3000") is not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(text);
  if (!hasScheme) text = "https://" + text;
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
  // The length check above counts the typed text; the href can be much longer (å → %C3%A5).
  if (tooLong(url.href)) return { error: "errUrlTooLong", visible: true };
  const summary = url.hostname + (url.pathname === "/" ? "" : url.pathname);
  return { payload: url.href, summary: summary, warning: warning };
}

/* ---- Plain text -------------------------------------------------------- */

function buildText(input) {
  const text = String(input.text == null ? "" : input.text).replace(/\r\n?/g, "\n");
  if (!text.trim()) return { error: "text" };
  if (tooLong(text)) return { error: "errTextTooLong", visible: true };
  const firstLine = text.trim().split("\n")[0];
  return { payload: text, summary: shorten(firstLine, 40) };
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
  // extra headers such as cc/bcc. Line breaks in the body are CRLF, as RFC 6068 requires.
  if (subject) params.push("subject=" + encodeURIComponent(subject));
  if (body.trim()) params.push("body=" + encodeURIComponent(body.replace(/\n/g, "\r\n")));
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
    // URL is a URI value, not text: it is not escaped (a normalised href has no line breaks).
    lines.push("URL:" + u.url.href);
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

// Returns the coordinate as written (decimal point, no "+", no leading zeros), or null.
// The text is kept instead of String(number), which would write 0.0000001 as "1e-7".
function parseCoordinate(raw, limit) {
  const text = clean(raw).replace(",", ".");
  if (!/^[-+]?\d{1,3}(\.\d{1,8})?$/.test(text)) return null;
  if (Math.abs(parseFloat(text)) > limit) return null;
  return text.replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1");
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

/* ---- Calendar event (iCalendar, RFC 5545) ------------------------------ */

// Parses "YYYY-MM-DD" (the value of <input type="date">) into a UTC timestamp, or null.
function parseDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(raw));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2999) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  // Rejects dates that roll over, such as 2026-02-30.
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? ms : null;
}

// Parses "HH:MM" (the value of <input type="time">) into milliseconds since midnight, or null.
function parseTime(raw) {
  const m = /^(\d{2}):(\d{2})$/.exec(clean(raw));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return (+m[1] * 60 + +m[2]) * 60000;
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

// Timestamps are handled in UTC only as arithmetic; the output has no "Z" and no time zone.
function icalDate(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}

function icalDateTime(ms) {
  const d = new Date(ms);
  return icalDate(ms) + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + "00";
}

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

// Times are written as "floating" local time (no time zone): an event at 14:00 shows at 14:00
// on every phone, which is what people expect from a poster or an invitation.
// All-day events use VALUE=DATE with an exclusive end date, as RFC 5545 requires.
// Text values are escaped like vCard (RFC 5545 uses the same rules), so nothing can start a
// new property or end the event early.
function buildEvent(input) {
  const title = clean(input.title);
  if (!title) return { error: "event" };
  const allDay = input.allDay === true;
  const startDay = parseDate(input.startDate);
  const startTime = allDay ? 0 : parseTime(input.startTime);
  if (startDay === null || startTime === null) return { error: "errEventStart", visible: true };
  const start = startDay + startTime;

  let end;
  const endDay = clean(input.endDate) ? parseDate(input.endDate) : startDay;
  if (endDay === null) return { error: "errEventEnd", visible: true };
  if (allDay) {
    end = endDay + DAY_MS;
  } else if (clean(input.endTime)) {
    const endTime = parseTime(input.endTime);
    if (endTime === null) return { error: "errEventEnd", visible: true };
    end = endDay + endTime;
  } else {
    end = clean(input.endDate) ? endDay + startTime + HOUR_MS : start + HOUR_MS;
  }
  if (end <= start) return { error: "errEventEnd", visible: true };

  const props = ["SUMMARY:" + escapeVcard(title)];
  if (allDay) {
    props.push("DTSTART;VALUE=DATE:" + icalDate(start), "DTEND;VALUE=DATE:" + icalDate(end));
  } else {
    props.push("DTSTART:" + icalDateTime(start), "DTEND:" + icalDateTime(end));
  }
  if (clean(input.location)) props.push("LOCATION:" + escapeVcard(input.location));
  if (clean(input.description)) props.push("DESCRIPTION:" + escapeVcard(input.description));
  // PRODID, UID and DTSTAMP are required by RFC 5545. They are derived from the event so the
  // same event always gives the same code: scanning two printouts updates one calendar entry
  // instead of creating two. DTSTAMP must be UTC; the start day is used, not the clock.
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//offline-qr-tools//EN", "BEGIN:VEVENT",
    "UID:" + hashHex(props.join("\n")) + "@offline-qr-tools",
    "DTSTAMP:" + icalDate(startDay) + "T000000Z"].concat(props, ["END:VEVENT", "END:VCALENDAR"]);

  const payload = lines.join("\r\n");
  if (tooLong(payload)) return { error: "errTextTooLong", visible: true };
  return { payload: payload, summary: title };
}

/* ---- Swish payment -------------------------------------------------------- */

// Swish's own QR generator encodes a plain https link. The phone camera opens it and the
// universal link hands it to the Swish app (the older "C<payee>;<amount>;…" text only works
// from the scanner inside the app). Parameters: sw = payee, amt = amount (decimal point),
// cur = SEK, msg = message, edit = fields the payer may change (omitted = locked), src = qr.
// The payee is never editable, so a printed code cannot be redirected to another number.
// The link is built exactly like Swish's own QR generator (swish.nu/marknadsmaterial/qr-generator,
// checked by decoding the codes it produces):
//   ?sw=<payee>[&amt=<amount>&cur=SEK]&msg=<message, may be empty>[&edit=amt,msg]&src=qr
// "msg" is always present: a locked empty message ("msg=" without edit) means the payer cannot
// write one. An empty amount is simply left out and is always open; only a filled amount can
// be locked. Defaults when no choice is given: a filled amount is locked, the message is locked
// when filled and open when empty.
const SWISH_BASE_URL = "https://app.swish.nu/1/p/sw/";
const SWISH_MESSAGE_MAX = 50; // the app shows and stores 50 characters
const SWISH_AMOUNT_MAX = 999999.99;

// Mobile numbers 07xxxxxxxx (also written +46 7… or 0046 7…), company numbers 123xxxxxxx
// and charity "90 accounts" 90xxxxx. Spaces, dashes and brackets are formatting only.
function normalizeSwishNumber(raw) {
  const text = clean(raw);
  if (!/^\+?[\d\s\-()]+$/.test(text)) return null;
  let digits = text.replace(/[^\d]/g, "");
  if (text.charAt(0) === "+") {
    // Swish is Swedish only: any other country code is an error, not a "90 account".
    if (digits.indexOf("46") !== 0) return null;
    digits = "0" + digits.slice(2);
  } else if (digits.indexOf("0046") === 0) {
    digits = "0" + digits.slice(4);
  }
  return /^07\d{8}$/.test(digits) || /^123\d{7}$/.test(digits) || /^90\d{5}$/.test(digits) ? digits : null;
}

// "149,50", "149.5" or "1 000" → "149.5" / "1000" (written like Swish's own generator, which
// sends the amount as a number); null when invalid or out of range.
function normalizeSwishAmount(raw) {
  const text = clean(raw).replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (value < 1 || value > SWISH_AMOUNT_MAX) return null;
  return String(value);
}

// "0701234567" → "070-123 45 67", "1231234567" → "123 123 45 67" (display only).
function formatSwishNumber(n) {
  if (n.indexOf("07") === 0) return n.slice(0, 3) + "-" + n.slice(3, 6) + " " + n.slice(6, 8) + " " + n.slice(8);
  if (n.indexOf("123") === 0) return n.slice(0, 3) + " " + n.slice(3, 6) + " " + n.slice(6, 8) + " " + n.slice(8);
  return n.slice(0, 2) + " " + n.slice(2);
}

function buildSwish(input) {
  if (!clean(input.number)) return { error: "swish" };
  const number = normalizeSwishNumber(input.number);
  if (!number) return { error: "errSwishNumber", visible: true };

  let amount = null;
  if (clean(input.amount)) {
    amount = normalizeSwishAmount(input.amount);
    if (amount === null) return { error: "errSwishAmount", visible: true };
  }
  const message = clean(input.message);
  // Control characters (line breaks etc.) cannot be shown in Swish and are rejected.
  if (message.length > SWISH_MESSAGE_MAX || /[\u0000-\u001f\u007f]/.test(message)) return { error: "errSwishMessage", visible: true };

  const amountLocked = Boolean(amount) && (typeof input.amountLocked === "boolean" ? input.amountLocked : true);
  const messageLocked = typeof input.messageLocked === "boolean" ? input.messageLocked : Boolean(message);
  const edit = [];
  if (amount && !amountLocked) edit.push("amt");
  if (!messageLocked) edit.push("msg");

  const params = ["sw=" + number];
  if (amount) params.push("amt=" + amount, "cur=SEK");
  params.push("msg=" + encodeURIComponent(message));
  if (edit.length) params.push("edit=" + edit.join(","));
  params.push("src=qr");
  return { payload: SWISH_BASE_URL + "?" + params.join("&"), summary: formatSwishNumber(number) };
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
  geo: { build: buildGeo },
  event: { build: buildEvent },
  swish: { build: buildSwish }
};

const QR_TYPE_IDS = Object.keys(QR_TYPES);

function buildQrPayload(type, input) {
  const t = QR_TYPES[type];
  if (!t) return { error: "type" };
  // Every text field is made well-formed first, so no builder ever sees half an emoji.
  const safe = {};
  Object.keys(input || {}).forEach(function(key) {
    safe[key] = typeof input[key] === "string" ? toWellFormed(input[key]) : input[key];
  });
  return t.build(safe);
}
