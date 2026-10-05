"use strict";

/* =========================================================================
 * Logo upload (hardened)
 *  - size cap before reading, magic-byte sniffing (PNG/JPEG only, no SVG),
 *  - dimension cap, then re-encoded through a canvas to a clean PNG so no
 *    original bytes (metadata, polyglot payloads) ever reach an export.
 *  - The same pipeline (loadLogoBuffer) is used for logos inside design files.
 *
 * Depends on: jQuery, ui/state.js; showMessage()/updatePreview() from app.js at event time
 * (the load functions are only called after app.js has loaded)
 * ========================================================================= */

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_DIMENSION = 4096;
const LOGO_NORMALIZED_MAX = 1024;

function sniffImageMime(bytes) {
  const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (bytes.length >= 8 && png.every(function(b, i) { return bytes[i] === b; })) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  return null;
}

// Every load gets a number. Decoding is asynchronous, so a slow, older load (or one the user
// has removed in the meantime) must never overwrite what was chosen after it.
let logoLoadSeq = 0;

function clearLogo() {
  logoLoadSeq++;
  logoImage = null;
  logoDataUrl = null;
  $("#logoFile").val("");
  $("#logoPreview").empty().append($("<span class='logo-none' data-i18n='none'></span>").text(t("none")));
  $("#removeLogo").hide();
  $("#logoExtras").hide();
}

function rejectLogo(key) {
  clearLogo();
  showMessage("#logoError", key);
  updatePreview();
}

function loadImage(src) {
  return new Promise(function(resolve, reject) {
    const img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject("logoErrRead"); };
    img.src = src;
  });
}

// Re-encodes a decoded image to a clean PNG data URL → Promise<{ img, dataUrl }>.
function normalizeLogo(img) {
  const scale = Math.min(1, LOGO_NORMALIZED_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/png");
  return loadImage(dataUrl).then(function(clean) { return { img: clean, dataUrl: dataUrl }; });
}

// The hardened pipeline, shared by the file picker and design files (js/ui/design-file.js):
// size cap → sniff → decode → dimension check → re-encode. The original bytes are only ever
// decoded. Resolves to { img, dataUrl }; rejects with an i18n error key. Changes nothing.
function decodeLogoBuffer(buf) {
  if (buf.byteLength > LOGO_MAX_BYTES) return Promise.reject("logoErrSize");
  const mime = sniffImageMime(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
  if (!mime) return Promise.reject("logoErrType");
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
  return loadImage(blobUrl).then(function(img) {
    URL.revokeObjectURL(blobUrl);
    if (!img.naturalWidth || img.naturalWidth > LOGO_MAX_DIMENSION || img.naturalHeight > LOGO_MAX_DIMENSION) {
      throw "logoErrDims";
    }
    return normalizeLogo(img);
  }, function(key) {
    URL.revokeObjectURL(blobUrl);
    throw key;
  });
}

// Shows a decoded logo right away (and cancels any load still in progress).
function useDecodedLogo(logo) {
  logoLoadSeq++;
  logoImage = logo.img;
  logoDataUrl = logo.dataUrl;
  showMessage("#logoError", null);
  $("#logoPreview").empty().append($("<img>").attr({ src: logo.dataUrl, alt: t("logoPreviewAlt") }));
  $("#removeLogo").show();
  $("#logoExtras").show();
  updatePreview();
}

// Applies the result of a load only if no newer load or removal happened meanwhile.
function finishLogoLoad(promise) {
  const seq = ++logoLoadSeq;
  showMessage("#logoError", null);
  promise.then(function(logo) {
    if (seq === logoLoadSeq) useDecodedLogo(logo);
  }, function(key) {
    if (seq === logoLoadSeq) rejectLogo(typeof key === "string" ? key : "logoErrRead");
  });
}

function loadLogoBuffer(buf) {
  finishLogoLoad(decodeLogoBuffer(buf));
}

// Logos shipped with the app (the Swish symbol in js/assets/swish-symbols.js). They are trusted
// files, not user input, but still go through the same re-encode step so every logo in the
// app is a clean PNG data URL. Only data URLs from the bundled list are accepted.
function loadBundledLogo(dataUrl) {
  const bundled = typeof SWISH_SYMBOLS === "object" ? Object.keys(SWISH_SYMBOLS).map(function(k) { return SWISH_SYMBOLS[k]; }) : [];
  if (bundled.indexOf(dataUrl) < 0) return;
  finishLogoLoad(loadImage(dataUrl).then(normalizeLogo));
}

$("#logoFile").on("change", function(e) {
  const file = e.target.files && e.target.files[0];
  showMessage("#logoError", null);
  if (!file) return;
  // Checked before reading so a huge file is never loaded into memory.
  if (file.size > LOGO_MAX_BYTES) { rejectLogo("logoErrSize"); return; }
  finishLogoLoad(file.arrayBuffer().then(decodeLogoBuffer, function() { throw "logoErrRead"; }));
});

$("#removeLogo").on("click", function() {
  clearLogo();
  showMessage("#logoError", null);
  updatePreview();
});
