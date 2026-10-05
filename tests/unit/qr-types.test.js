"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js", "js/core/payload.js", "js/core/qr-types.js"], { URL });
const raw = get("buildQrPayload");
const build = (type, input) => plain(raw(type, input));

test("registry exposes all types", () => {
  assert.deepEqual(plain(get("QR_TYPE_IDS")), ["wifi", "url", "text", "email", "phone", "sms", "vcard", "geo", "event", "swish"]);
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
  // Line breaks in the body are CRLF (%0D%0A), as RFC 6068 requires.
  assert.equal(r.payload, "mailto:info@example.se?subject=Hej%20%26%20v%C3%A4lkommen%3F&body=Rad%201%0D%0ARad%202");
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

/* ---- Calendar event ---------------------------------------------------- */

const ev = (input) => plain(build("event", input));
const lines = (r) => r.payload.split("\r\n");

test("event: timed event with floating local time and CRLF lines", () => {
  const r = ev({ title: "Öppet hus", location: "Storgatan 1, Strömstad", startDate: "2026-10-03", startTime: "14:00", endDate: "", endTime: "16:30", description: "Fika finns" });
  const out = lines(r);
  assert.match(out[4], /^UID:[0-9a-f]{16}@offline-qr-tools$/);
  assert.deepEqual(out.slice(0, 4).concat(out.slice(5)), [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//offline-qr-tools//EN", "BEGIN:VEVENT",
    "DTSTAMP:20261003T000000Z", "SUMMARY:Öppet hus",
    "DTSTART:20261003T140000", "DTEND:20261003T163000",
    "LOCATION:Storgatan 1\\, Strömstad", "DESCRIPTION:Fika finns",
    "END:VEVENT", "END:VCALENDAR"
  ]);
  assert.equal(r.summary, "Öppet hus");
  // No time zone on the event times: the same wall-clock time everywhere. (DTSTAMP is UTC by
  // definition in RFC 5545; it is a record date, not when the event happens.)
  assert.ok(out.filter((l) => /^DT(START|END)/.test(l)).every((l) => !/Z$|TZID/.test(l)), "no time zone");
});

test("event: without end the event lasts one hour, also across midnight", () => {
  assert.ok(ev({ title: "A", startDate: "2026-10-03", startTime: "09:15" }).payload.includes("DTEND:20261003T101500"));
  assert.ok(ev({ title: "A", startDate: "2026-12-31", startTime: "23:30" }).payload.includes("DTEND:20270101T003000"));
  // End date without end time: same time of day plus one hour on the end date.
  assert.ok(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endDate: "2026-10-05" }).payload.includes("DTEND:20261005T110000"));
});

test("event: all-day events use dates with an exclusive end", () => {
  const one = ev({ title: "Midsommar", allDay: true, startDate: "2026-06-19", startTime: "garbage" });
  assert.ok(one.payload.includes("DTSTART;VALUE=DATE:20260619\r\nDTEND;VALUE=DATE:20260620"));
  const many = ev({ title: "Mässa", allDay: true, startDate: "2026-02-27", endDate: "2026-03-01" });
  assert.ok(many.payload.includes("DTEND;VALUE=DATE:20260302"));
});

test("event: missing title is silent; bad or missing dates and reversed ranges are visible errors", () => {
  assert.deepEqual(ev({ title: " ", startDate: "2026-10-03", startTime: "10:00" }), { error: "event" });
  assert.equal(ev({ title: "A" }).error, "errEventStart");
  assert.equal(ev({ title: "A", startDate: "2026-10-03" }).error, "errEventStart");
  assert.equal(ev({ title: "A", startDate: "2026-02-30", startTime: "10:00" }).error, "errEventStart");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "24:00" }).error, "errEventStart");
  assert.equal(ev({ title: "A", startDate: "0999-10-03", startTime: "10:00" }).error, "errEventStart");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endTime: "09:00" }).error, "errEventEnd");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endTime: "10:00" }).error, "errEventEnd");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endDate: "2026-10-02" }).error, "errEventEnd");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endDate: "bad" }).error, "errEventEnd");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", endTime: "7pm" }).error, "errEventEnd");
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00" }).visible, undefined);
  assert.equal(ev({ title: "A" }).visible, true);
});

test("event: text cannot inject properties or end the event early", () => {
  const r = ev({ title: "Party\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Phish", location: "a;b,c\\d", startDate: "2026-10-03", startTime: "10:00",
    description: "line1\nATTACH:http://evil.example/x" });
  const ls = lines(r);
  assert.equal(ls.filter((l) => l === "END:VEVENT").length, 1);
  assert.equal(ls.filter((l) => l.startsWith("BEGIN:VEVENT")).length, 1);
  assert.ok(ls.includes("SUMMARY:Party\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:Phish"));
  assert.ok(ls.includes("LOCATION:a\\;b\\,c\\\\d"));
  assert.ok(!ls.some((l) => l.startsWith("ATTACH")));
});

test("event: the payload size is capped", () => {
  assert.equal(ev({ title: "A", startDate: "2026-10-03", startTime: "10:00", description: "x".repeat(1200) }).error, "errTextTooLong");
});

/* ---- Swish ---------------------------------------------------------------- */

const sw = (input) => plain(build("swish", input));
const BASE = "https://app.swish.nu/1/p/sw/?";

// Expected links are exactly what Swish's own QR generator encodes for the same settings
// (decoded from its codes, see AGENTS.md).
test("swish: links match Swish's own generator", () => {
  const swish = (input) => sw(Object.assign({ number: "1231234567" }, input)).payload;
  assert.equal(swish({ messageLocked: true }), BASE + "sw=1231234567&msg=&src=qr");
  assert.equal(swish({ messageLocked: false }), BASE + "sw=1231234567&msg=&edit=msg&src=qr");
  assert.equal(swish({ amount: "50", message: "Fika", amountLocked: true, messageLocked: true }), BASE + "sw=1231234567&amt=50&cur=SEK&msg=Fika&src=qr");
  assert.equal(swish({ amount: "50", message: "Fika", amountLocked: false, messageLocked: false }), BASE + "sw=1231234567&amt=50&cur=SEK&msg=Fika&edit=amt,msg&src=qr");
  assert.equal(swish({ amount: "49,50", amountLocked: true, messageLocked: true }), BASE + "sw=1231234567&amt=49.5&cur=SEK&msg=&src=qr");
});

test("swish: number formats are normalised; summary is formatted for display", () => {
  assert.deepEqual(sw({ number: "+46 70-123 45 67", amount: "149,5", message: "Faktura 1042" }), {
    payload: BASE + "sw=0701234567&amt=149.5&cur=SEK&msg=Faktura%201042&src=qr", summary: "070-123 45 67"
  });
  assert.equal(sw({ number: "123 123 45 67", amount: "1 000" }).payload, BASE + "sw=1231234567&amt=1000&cur=SEK&msg=&edit=msg&src=qr");
  assert.equal(sw({ number: "0046701234567" }).summary, "070-123 45 67");
  assert.equal(sw({ number: "900 1234" }).payload, BASE + "sw=9001234&msg=&edit=msg&src=qr");
});

test("swish: defaults lock what is filled; an empty amount is always open and never in edit", () => {
  assert.equal(sw({ number: "0701234567", message: "Fika" }).payload, BASE + "sw=0701234567&msg=Fika&src=qr");
  assert.equal(sw({ number: "0701234567", amountLocked: true, messageLocked: true }).payload, BASE + "sw=0701234567&msg=&src=qr");
  const open = sw({ number: "0701234567", amount: "50", message: "Fika", amountLocked: false, messageLocked: false }).payload;
  assert.doesNotMatch(open, /edit=[^&]*sw/);
});

test("swish: invalid numbers, amounts and messages are visible errors; empty number is silent", () => {
  assert.deepEqual(sw({ number: " " }), { error: "swish" });
  for (const number of ["0812345678", "070123456", "07012345678", "1241234567", "+47 70 123 45 67", "070-123 45 67; x", "javascript:alert(1)"]) {
    assert.equal(sw({ number }).error, "errSwishNumber", number);
  }
  for (const amount of ["0", "0,50", "1000000", "12,345", "-5", "1e3", "abc", "100 kr"]) {
    assert.equal(sw({ number: "0701234567", amount }).error, "errSwishAmount", amount);
  }
  assert.equal(sw({ number: "0701234567", message: "x".repeat(51) }).error, "errSwishMessage");
  assert.equal(sw({ number: "0701234567", message: "a\nb" }).error, "errSwishMessage");
});

test("swish: the message cannot add or override URL parameters", () => {
  const p = sw({ number: "0701234567", amount: "10", message: "x&sw=0709999999&amt=1#frag?" }).payload;
  const url = new URL(p);
  assert.equal(url.searchParams.get("sw"), "0701234567");
  assert.equal(url.searchParams.get("amt"), "10");
  assert.equal(url.searchParams.get("msg"), "x&sw=0709999999&amt=1#frag?");
  assert.equal(url.searchParams.getAll("sw").length, 1);
  assert.equal(url.hash, "");
  assert.equal(url.origin + url.pathname, "https://app.swish.nu/1/p/sw/");
});

/* ---- Regressions found in the code review ------------------------------ */

test("event: PRODID, UID and DTSTAMP are present and the same event always gives the same code", () => {
  const input = { title: "Fest", startDate: "2026-12-24", startTime: "18:00", endDate: "", endTime: "" };
  const a = ev(input), b = ev(input);
  assert.equal(a.payload, b.payload, "deterministic");
  for (const prop of ["PRODID:", "UID:", "DTSTAMP:"]) assert.equal(lines(a).filter((l) => l.startsWith(prop)).length, 1, prop);
  assert.notEqual(lines(ev(Object.assign({}, input, { title: "Annan fest" }))).find((l) => l.startsWith("UID:")),
    lines(a).find((l) => l.startsWith("UID:")), "another event gets another UID");
});

test("geo: coordinates are written as typed, never in exponent notation", () => {
  assert.equal(build("geo", { lat: "0.0000001", lon: "-0.00000005" }).payload, "geo:0.0000001,-0.00000005");
  assert.equal(build("geo", { lat: "+058.9", lon: "011" }).payload, "geo:58.9,11");
  assert.equal(build("geo", { lat: "-0.5", lon: "0" }).payload, "geo:-0.5,0");
  assert.equal(build("geo", { lat: "90.1", lon: "0" }).error, "errGeoInvalid");
});

test("half an emoji (a lone surrogate) never crashes a builder or reaches a payload", () => {
  const broken = "x\uD800y\uDC00";
  const cases = [
    ["email", { to: "a@example.com", subject: broken, body: broken }],
    ["swish", { number: "0701234567", message: broken }],
    ["text", { text: broken }],
    ["sms", { number: "0701234567", message: broken }],
    ["vcard", { firstName: broken }],
    ["event", { title: broken, startDate: "2026-10-03", startTime: "10:00" }],
    ["wifi", { ssid: broken, password: "correct horse", security: "WPA" }]
  ];
  for (const [type, input] of cases) {
    const r = build(type, input);
    assert.ok(r.payload, type);
    assert.doesNotMatch(r.payload, /[\uD800-\uDFFF]/, type);
  }
});

test("text: the summary never cuts an emoji in half", () => {
  const r = build("text", { text: "a".repeat(38) + "😀😀😀" });
  assert.equal(r.summary, "a".repeat(38) + "😀…");
});

test("url: the encoded address is capped too, not only what was typed", () => {
  assert.equal(build("url", { url: "example.com/" + "å".repeat(1900) }).error, "errUrlTooLong");
  assert.equal(build("url", { url: "https://example.com/" + "a".repeat(1900) }).error, "errUrlTooLong");
  assert.ok(build("url", { url: "https://example.com/" + "a".repeat(900) }).payload);
});

test("url: a host with a port is an address, not a scheme", () => {
  assert.equal(build("url", { url: "example.com:8080/menu" }).payload, "https://example.com:8080/menu");
  assert.equal(build("url", { url: "localhost:3000" }).payload, "https://localhost:3000/");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
    assert.ok(build("url", { url: bad }).error, bad);
  }
});

test("vcard: the website is a URI value and is not text-escaped", () => {
  const r = build("vcard", { firstName: "A", url: "https://example.com/a,b;c" });
  assert.ok(r.payload.split("\r\n").includes("URL:https://example.com/a,b;c"));
});

test("email: '#' and '%' in an address are rejected (fragment / percent-decoding tricks)", () => {
  assert.equal(build("email", { to: "a#b@example.com" }).error, "errEmailInvalid");
  assert.equal(build("email", { to: "a%3Fcc%3Devil@example.com" }).error, "errEmailInvalid");
});

test("swish: a foreign country code is rejected, not read as a 90 account", () => {
  assert.equal(build("swish", { number: "+90 12345" }).error, "errSwishNumber");
  assert.equal(build("swish", { number: "+1 070 123 45 67" }).error, "errSwishNumber");
  assert.ok(build("swish", { number: "+46 70 123 45 67" }).payload.includes("sw=0701234567"));
});
