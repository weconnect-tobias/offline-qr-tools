"use strict";

/* =========================================================================
 * Wi-Fi password generator (pure — the random source is passed in)
 *
 * Produces passwords like "k7Pqz-Xm4tR-9bHwe-Fs2Nd": 4 groups of 5 characters from an
 * alphabet without look-alikes (0/O, 1/l/I, o), so it can be typed from a printed note.
 * 20 random characters from 56 symbols = 116 bits of entropy, far beyond what is needed for
 * WPA2/WPA3, and 23 characters long, inside WPA's 8–63 limit.
 *
 * SECURITY: the UI passes crypto.getRandomValues (never Math.random). Uniform selection uses
 * rejection sampling, so no character is more likely than another (no modulo bias).
 * The password is generated locally and never leaves the browser.
 *
 * Depends on: nothing.
 * ========================================================================= */

const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_GROUPS = 4;
const PASSWORD_GROUP_LENGTH = 5;

// randomBytes(n) must return n cryptographically random bytes (Uint8Array).
function generateWifiPassword(randomBytes) {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n); // bytes >= limit are discarded to avoid modulo bias
  const chars = [];
  while (chars.length < PASSWORD_GROUPS * PASSWORD_GROUP_LENGTH) {
    const bytes = randomBytes(32);
    for (let i = 0; i < bytes.length && chars.length < PASSWORD_GROUPS * PASSWORD_GROUP_LENGTH; i++) {
      if (bytes[i] < limit) chars.push(PASSWORD_ALPHABET.charAt(bytes[i] % n));
    }
  }
  const groups = [];
  for (let g = 0; g < PASSWORD_GROUPS; g++) groups.push(chars.slice(g * PASSWORD_GROUP_LENGTH, (g + 1) * PASSWORD_GROUP_LENGTH).join(""));
  return groups.join("-");
}
