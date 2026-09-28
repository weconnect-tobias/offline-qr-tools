"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js", "js/core/payload.js", "js/core/qr-types.js"], { URL });
const raw = get("buildQrPayload");
const build = (type, input) => plain(raw(type, input));

test("registry exposes all types", () => {
  assert.deepEqual(plain(get("QR_TYPE_IDS")), ["wifi", "url", "text", "email", "phone", "sms", "vcard", "geo"]);
  assert.deepEqual(build("nope", {}), { error: "type" });
});

test("wifi summary is the SSID only, never the password", () => {
  const r = build("wifi", { ssid: "Office", password: "Topsecret-4711", security: "WPA" });
  assert.equal(r.summary, "Office");
  assert.ok(!JSON.stringify(r.summary).includes("Topsecret"));
});

/* ---- URL ---- */

test("url: adds https:// when no scheme is given and normalises the host", () => {
  assert.deepEqual(build("url", { url: "  Example.COM/menu " }), { payload: "https://example.com/menu", summary: "example.com/menu", warning: null });
});

test("url: dangerous schemes are rejected, not 'fixed'", () => {
  for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x", "ftp://example.com", "intent://x#Intent;end"]) {
    assert.deepEqual(build("url", { url: u }), { error: "errUrlScheme", visible: true }, u);
  }
});

test("url: embedded credentials (https://bank.com@evil.example) are rejected", () => {
  assert.equal(build("url", { url: "https://bank.example@evil.example/login" }).error, "errUrlCredentials");
  assert.equal(build("url", { url: "https://user:pw@example.com" }).error, "errUrlCredentials");
});

test("url: http and punycode hosts are allowed but flagged", () => {
  assert.equal(build("url", { url: "http://example.com" }).warning, "warnUrlHttp");
  assert.equal(build("url", { url: "https://аpple.com" }).warning, "warnUrlPunycode"); // Cyrillic "а"
  assert.equal(build("url", { url: "https://xn--pple-43d.com" }).warning, "warnUrlPunycode");
});

test("url: invalid, empty and oversized input", () => {
  assert.deepEqual(build("url", { url: "" }), { error: "url" });
  assert.equal(build("url", { url: "not a url" }).error, "errUrlInvalid");
  assert.equal(build("url", { url: "https://nodot" }).error, "errUrlInvalid");
  assert.equal(build("url", { url: "https://example.com/" + "a".repeat(2000) }).error, "errUrlTooLong");
});

/* ---- Text ---- */

test("text: kept verbatim (CRLF normalised); summary is the first line", () => {
  assert.deepEqual(build("text", { text: "Hello\r\nWorld" }), { payload: "Hello\nWorld", summary: "Hello" });
  assert.deepEqual(build("text", { text: "   " }), { error: "text" });
  assert.equal(build("text", { text: "ö".repeat(501) }).error, "errTextTooLong"); // 1002 bytes
});

/* ---- E-mail ---- */

test("email: mailto with encoded subject and body", () => {
  const r = build("email", { to: "info@example.se", subject: "Hej & välkommen?", body: "Rad 1\nRad 2" });
  assert.equal(r.payload, "mailto:info@example.se?subject=Hej%20%26%20v%C3%A4lkommen%3F&body=Rad%201%0ARad%202");
  assert.equal(r.summary, "info@example.se");
});

test("email: header injection via address or subject is impossible", () => {
  for (const to of ["a@b.se?cc=spy@evil.example", "a@b.se&bcc=x@y.se", "a@b.se,spy@evil.example", "a@b.se\nBcc: x@y.se", "a b@c.se", "@b.se", "a@b"]) {
    assert.equal(build("email", { to }).error, "errEmailInvalid", to);
  }
  const r = build("email", { to: "a@b.se", subject: "x\r\nBcc: spy@evil.example" });
  assert.ok(!/[\r\n]/.test(r.payload) && r.payload.includes("%0D%0ABcc"));
});

/* ---- Phone / SMS ---- */

test("phone: formatting characters removed, leading + kept", () => {
  assert.deepEqual(build("phone", { number: "+46 (0)70-123 45.67" }), { payload: "tel:+460701234567", summary: "+460701234567" });
  assert.equal(build("phone", { number: "070-123 45 67" }).payload, "tel:0701234567");
  for (const bad of ["12", "abc", "070;1234", "+46 70 123 45 67 89 01 23 45 67", "tel:123"]) assert.equal(build("phone", { number: bad }).error, "errPhoneInvalid", bad);
});

test("sms: SMSTO format, message may contain colons and newlines", () => {
  assert.deepEqual(build("sms", { number: "+46 70 123 45 67", message: "Tid: 12:00\nOK?" }),
    { payload: "SMSTO:+46701234567:Tid: 12:00\nOK?", summary: "+46701234567" });
  assert.deepEqual(build("sms", { number: "" }), { error: "sms" });
});

/* ---- vCard ---- */

test("vcard: complete card in vCard 3.0 with CRLF line breaks", () => {
  const r = build("vcard", { firstName: "Anna", lastName: "Svensson", org: "Exempel AB", title: "IT-chef",
    phone: "+46 70 123 45 67", email: "anna@exempel.se", url: "exempel.se", street: "Storgatan 1", city: "Strömstad", zip: "452 30", country: "Sverige", note: "Ring efter 9" });
  assert.equal(r.payload, [
    "BEGIN:VCARD", "VERSION:3.0", "N:Svensson;Anna;;;", "FN:Anna Svensson", "ORG:Exempel AB", "TITLE:IT-chef",
    "TEL;TYPE=CELL:+46701234567", "EMAIL:anna@exempel.se", "URL:https://exempel.se/",
    "ADR;TYPE=WORK:;;Storgatan 1;Strömstad;;452 30;Sverige", "NOTE:Ring efter 9", "END:VCARD"].join("\r\n"));
  assert.equal(r.summary, "Anna Svensson");
});

test("vcard: values cannot inject properties or extra cards", () => {
  const r = build("vcard", { firstName: "Anna\nEND:VCARD\nBEGIN:VCARD\nFN:Evil", org: "A;B,C\\D" });
  const lines = r.payload.split("\r\n");
  assert.equal(lines.filter((l) => l === "END:VCARD").length, 1);
  assert.equal(lines.filter((l) => l.startsWith("FN:")).length, 1);
  assert.ok(lines.includes("ORG:A\\;B\\,C\\\\D"));
});

test("vcard: needs a name or organisation; embedded URL/e-mail/phone are validated", () => {
  assert.deepEqual(build("vcard", { title: "Only a title" }), { error: "vcard" });
  assert.equal(build("vcard", { org: "X", url: "javascript:alert(1)" }).error, "errUrlScheme");
  assert.equal(build("vcard", { org: "X", email: "bad@" }).error, "errEmailInvalid");
  assert.equal(build("vcard", { org: "X", phone: "abc" }).error, "errPhoneInvalid");
  assert.equal(build("vcard", { org: "Only org" }).summary, "Only org");
});

/* ---- Geo ---- */

test("geo: decimal coordinates, comma accepted as decimal separator", () => {
  assert.deepEqual(build("geo", { lat: "58,9395", lon: "11.1712" }), { payload: "geo:58.9395,11.1712", summary: "58.9395,11.1712" });
  assert.deepEqual(build("geo", { lat: "", lon: "" }), { error: "geo" });
  for (const [lat, lon] of [["91", "0"], ["0", "181"], ["abc", "1"], ["1e3", "1"], ["58.1;x", "1"]]) {
    assert.equal(build("geo", { lat, lon }).error, "errGeoInvalid", lat + "," + lon);
  }
});
