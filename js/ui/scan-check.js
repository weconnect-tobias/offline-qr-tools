"use strict";

/* =========================================================================
 * Scan self-test
 *
 * Styling (dots, logos, colors, frames) can silently make a code unreadable.
 * After each change the rendered image is decoded locally with jsQR — nothing
 * leaves the browser — and compared byte-for-byte with the intended payload:
 *   1. at ~6 px per module, normal polarity          → must pass
 *   2. same, inverted polarity only                  → readable, but not by all scanners
 *   3. downscaled to ~3 px per module (distance / small print) → robustness margin
 *
 * Depends on: jsQR, ui/i18n.js, ui/state.js
 * ========================================================================= */

const SCAN_DEBOUNCE_MS = 250;
const SCAN_FULL_MODULE_PX = 6;   // plenty for a clean read, keeps the check fast
const SCAN_SMALL_MODULE_PX = 3;
const SCAN_STATUS_ICONS = { checking: "…", ok: "✓", warn: "!", fail: "✕", unavailable: "?" };

let scanTimer = null;
let scanToken = 0;
let pendingScan = null;
let lastScanStatus = null;

// A check that is still waiting must not report on a preview that has been replaced
// (by the demo, an error or nothing at all).
function cancelScanCheck() {
  clearTimeout(scanTimer);
  scanToken++;
  pendingScan = null;
}

function setScanStatus(status, key) {
  lastScanStatus = status;
  const el = $("#scanStatus");
  if (!status) {
    cancelScanCheck();
    el.attr("hidden", true).removeAttr("data-state");
    return;
  }
  el.removeAttr("hidden").attr("data-state", status);
  el.find(".scan-icon").text(SCAN_STATUS_ICONS[status]);
  el.find(".scan-text").attr("data-i18n", key).text(t(key));
}

// Draws the source onto an opaque white canvas (flattens transparent corners) at the given scale.
function canvasToImageData(src, scale) {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function decodesTo(imageData, expectedBytes, inversion) {
  let result;
  try {
    result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: inversion });
  } catch (e) {
    // jsQR 1.4.0 can throw inside its locator on images without usable finder patterns;
    // that is a failed read, not a broken test.
    return false;
  }
  if (!result || !result.binaryData || result.binaryData.length !== expectedBytes.length) return false;
  for (let i = 0; i < expectedBytes.length; i++) {
    if (result.binaryData[i] !== expectedBytes[i]) return false;
  }
  return true;
}

// Returns { status, key } where status is ok | warn | fail.
function verifyScan(canvas, cellPx, payload) {
  const expected = new TextEncoder().encode(payload);
  const full = canvasToImageData(canvas, Math.min(1, SCAN_FULL_MODULE_PX / cellPx));

  if (!decodesTo(full, expected, "dontInvert")) {
    // "invertFirst" rather than "onlyInvert": the latter never builds the inverted
    // bitmap in jsQR 1.4.0. Normal polarity already failed, so a hit here is an inverted read.
    if (decodesTo(full, expected, "invertFirst")) return { status: "warn", key: "scanInverted" };
    return { status: "fail", key: "scanFail" };
  }

  const scale = Math.min(1, SCAN_SMALL_MODULE_PX / cellPx);
  if (scale < 1 && !decodesTo(canvasToImageData(canvas, scale), expected, "dontInvert")) {
    return { status: "warn", key: "scanMarginal" };
  }
  return { status: "ok", key: "scanOk" };
}

function scheduleScanCheck(canvas, cellPx, payload) {
  if (typeof jsQR !== "function") {
    setScanStatus("unavailable", "scanUnavailable");
    return;
  }
  cancelScanCheck();
  const token = scanToken;
  setScanStatus("checking", "scanChecking");
  pendingScan = { canvas: canvas, cellPx: cellPx, payload: payload };
  scanTimer = setTimeout(function() {
    // Ignore results for a preview that has since been replaced.
    if (token === scanToken) runPendingScanCheck();
  }, SCAN_DEBOUNCE_MS);
}

// Runs a waiting check now, so a download never skips the "cannot be scanned" confirmation.
function runPendingScanCheck() {
  if (!pendingScan) return;
  const job = pendingScan;
  clearTimeout(scanTimer);
  pendingScan = null;
  let result;
  try {
    result = verifyScan(job.canvas, job.cellPx, job.payload);
  } catch (e) {
    result = { status: "unavailable", key: "scanUnavailable" };
  }
  setScanStatus(result.status, result.key);
}
