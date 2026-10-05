"use strict";

/* =========================================================================
 * Wi-Fi payload (pure — no DOM, no jQuery)
 *
 * Builds and validates the WIFI:… string encoded in the QR code.
 * Format: WIFI:T:<type>;S:<ssid>;P:<password>;H:<hidden>;;  (\\ ; , : " escaped)
 *
 * Depends on: core/util.js (escapeWifi, utf8ByteLength)
 * ========================================================================= */

const WIFI_SECURITY_TYPES = ["WPA", "WEP", "WPA2-EAP", "nopass"];
const EAP_METHODS = ["PEAP", "TTLS", "TLS", "PWD"];
const EAP_PHASE2_METHODS = ["MSCHAPV2", "GTC", "PAP", ""];
const SSID_MAX_BYTES = 32; // IEEE 802.11 limit

// Returns an i18n error key, or null when the password fits the security type.
function validatePassword(sec, pswd) {
  if (sec === "WPA") {
    if (/^[0-9a-fA-F]{64}$/.test(pswd)) return null;           // raw 256-bit PSK
    const n = utf8ByteLength(pswd);
    return n >= 8 && n <= 63 ? null : "errPswdWpa";            // passphrase
  }
  if (sec === "WEP") {
    if (/^([0-9a-fA-F]{10}|[0-9a-fA-F]{26})$/.test(pswd)) return null;
    return (pswd.length === 5 || pswd.length === 13) && /^[\x20-\x7e]+$/.test(pswd) ? null : "errPswdWep";
  }
  return null;
}

/**
 * @param {object} input { ssid, password, security, hidden, eapMethod, phase2, anonymous, identity }
 * @returns {{payload: string, ssid: string} | {error: string, visible?: boolean}}
 *   error is an i18n key; visible=true means it should be shown to the user
 *   (missing fields are silent because the form is simply not filled in yet).
 */
function buildWifiPayload(input) {
  const ssid = String(input.ssid || "").trim();
  const pswd = String(input.password || "");
  const sec = input.security;
  const hidden = input.hidden ? "true" : "false";

  if (WIFI_SECURITY_TYPES.indexOf(sec) < 0) return { error: "security" };
  if (!ssid) return { error: "ssid" };
  if (utf8ByteLength(ssid) > SSID_MAX_BYTES) return { error: "errSsidTooLong", visible: true };

  let payload;

  if (sec === "nopass") {
    payload = "WIFI:T:nopass;S:" + escapeWifi(ssid) + ";H:" + hidden + ";;";
  } else if (sec === "WPA2-EAP") {
    const eapMethod = input.eapMethod;
    const phase2 = input.phase2 || "";
    // Select values are inserted unescaped, so only known values are accepted.
    if (EAP_METHODS.indexOf(eapMethod) < 0 || EAP_PHASE2_METHODS.indexOf(phase2) < 0) return { error: "security" };
    const anon = !!input.anonymous;
    const identity = String(input.identity || "").trim();

    // The username (I:) is always needed to log in. "Anonymous outer identity" only adds A:,
    // the name sent unencrypted before the tunnel is set up; it does not replace the username.
    if (!identity) return { error: "identity" };
    if (!pswd) return { error: "pswd" };

    payload = "WIFI:T:WPA2-EAP;S:" + escapeWifi(ssid) + ";E:" + eapMethod;
    if (phase2) payload += ";PH2:" + phase2;
    if (anon) payload += ";A:anonymous";
    payload += ";I:" + escapeWifi(identity);
    payload += ";P:" + escapeWifi(pswd) + ";;";
  } else {
    if (!pswd) return { error: "pswd" };
    const pwError = validatePassword(sec, pswd);
    if (pwError) return { error: pwError, visible: true };
    payload = "WIFI:T:" + sec + ";S:" + escapeWifi(ssid) + ";P:" + escapeWifi(pswd) + ";H:" + hidden + ";;";
  }

  // NOTE: never prepend a BOM or anything else before "WIFI:" — Android's built-in
  // Wi-Fi QR reader requires the text to start exactly with "WIFI:".
  return { payload: payload, ssid: ssid };
}

// qrcode-generator encodes one byte per character by default (breaks å/ä/ö).
// The library ships a proper UTF-8 encoder that is disabled by default — enable it.
if (typeof qrcode !== "undefined" && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
}
