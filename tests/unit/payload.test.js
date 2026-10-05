"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts, plain } = require("../support/load-scripts");

const get = loadScripts(["js/core/util.js", "js/core/payload.js"]);
const build = get("buildWifiPayload");
const buildWifiPayload = (input) => plain(build(input));
const validatePassword = get("validatePassword");

const base = { ssid: "Office", password: "correct horse", security: "WPA", hidden: false };

test("WPA payload has the exact format Android and iOS expect", () => {
  assert.deepEqual(buildWifiPayload(base), { payload: "WIFI:T:WPA;S:Office;P:correct horse;H:false;;", ssid: "Office" });
});

test("payload always starts with WIFI: (no BOM or prefix)", () => {
  assert.ok(buildWifiPayload(base).payload.startsWith("WIFI:"));
});

test("special characters \\ ; , : \" are escaped in SSID and password", () => {
  const r = buildWifiPayload(Object.assign({}, base, { ssid: 'a;b,c:d"e\\f', password: 'p;w,d:1"2\\3' }));
  assert.equal(r.payload, 'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w\\,d\\:1\\"2\\\\3;H:false;;');
});

test("SSID is trimmed; hidden flag is emitted", () => {
  const r = buildWifiPayload(Object.assign({}, base, { ssid: "  Kafé Åkerö  ", hidden: true }));
  assert.equal(r.payload, "WIFI:T:WPA;S:Kafé Åkerö;P:correct horse;H:true;;");
});

test("open network omits the password", () => {
  const r = buildWifiPayload({ ssid: "Guest", password: "ignored", security: "nopass", hidden: false });
  assert.equal(r.payload, "WIFI:T:nopass;S:Guest;H:false;;");
  assert.ok(!r.payload.includes("ignored"));
});

test("WPA2-EAP with identity and phase 2", () => {
  const r = buildWifiPayload({ ssid: "Corp", password: "s3cret", security: "WPA2-EAP", eapMethod: "PEAP", phase2: "MSCHAPV2", identity: "user@corp.se" });
  assert.equal(r.payload, "WIFI:T:WPA2-EAP;S:Corp;E:PEAP;PH2:MSCHAPV2;I:user@corp.se;P:s3cret;;");
});

test("WPA2-EAP anonymous outer identity is added to the username, not instead of it", () => {
  const r = buildWifiPayload({ ssid: "Corp", password: "s3cret", security: "WPA2-EAP", eapMethod: "TTLS", phase2: "", anonymous: true, identity: "user@corp.se" });
  assert.equal(r.payload, "WIFI:T:WPA2-EAP;S:Corp;E:TTLS;A:anonymous;I:user@corp.se;P:s3cret;;");
  // Without a username nobody can log in, anonymous or not.
  assert.equal(buildWifiPayload({ ssid: "Corp", password: "s3cret", security: "WPA2-EAP", eapMethod: "TTLS", phase2: "", anonymous: true }).error, "identity");
});

test("unknown security type / EAP method / phase 2 are rejected (no raw injection)", () => {
  assert.equal(buildWifiPayload(Object.assign({}, base, { security: "WPA;P:evil" })).error, "security");
  assert.equal(buildWifiPayload({ ssid: "C", password: "x", security: "WPA2-EAP", eapMethod: "PEAP;X:1", identity: "u" }).error, "security");
  assert.equal(buildWifiPayload({ ssid: "C", password: "x", security: "WPA2-EAP", eapMethod: "PEAP", phase2: "EVIL", identity: "u" }).error, "security");
});

test("missing fields are silent errors; invalid values are visible errors", () => {
  assert.deepEqual(buildWifiPayload(Object.assign({}, base, { ssid: " " })), { error: "ssid" });
  assert.deepEqual(buildWifiPayload(Object.assign({}, base, { password: "" })), { error: "pswd" });
  assert.deepEqual(buildWifiPayload(Object.assign({}, base, { password: "short" })), { error: "errPswdWpa", visible: true });
  assert.deepEqual(buildWifiPayload({ ssid: "C", password: "x", security: "WPA2-EAP", eapMethod: "PEAP" }), { error: "identity" });
});

test("SSID limit is 32 bytes, not 32 characters", () => {
  assert.ok(buildWifiPayload(Object.assign({}, base, { ssid: "a".repeat(32) })).payload);
  assert.equal(buildWifiPayload(Object.assign({}, base, { ssid: "a".repeat(33) })).error, "errSsidTooLong");
  assert.equal(buildWifiPayload(Object.assign({}, base, { ssid: "å".repeat(17) })).error, "errSsidTooLong"); // 34 bytes
});

test("WPA password rules: 8-63 bytes or exactly 64 hex", () => {
  assert.equal(validatePassword("WPA", "1234567"), "errPswdWpa");
  assert.equal(validatePassword("WPA", "12345678"), null);
  assert.equal(validatePassword("WPA", "x".repeat(63)), null);
  assert.equal(validatePassword("WPA", "x".repeat(64)), "errPswdWpa");
  assert.equal(validatePassword("WPA", "ab".repeat(32)), null);
  assert.equal(validatePassword("WPA", "ö".repeat(32)), "errPswdWpa"); // 64 bytes
});

test("WEP key rules: 5/13 printable ASCII or 10/26 hex", () => {
  for (const ok of ["abcde", "abcdefghijklm", "0123456789", "0123456789abcdef0123456789"]) assert.equal(validatePassword("WEP", ok), null, ok);
  for (const bad of ["abcd", "abcdef", "åäöåä", "012345678"]) assert.equal(validatePassword("WEP", bad), "errPswdWep", bad);
});
