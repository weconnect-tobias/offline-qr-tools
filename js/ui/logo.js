"use strict";

/* =========================================================================
 * Logo upload (hardened)
 *  - size cap before reading, magic-byte sniffing (PNG/JPEG only, no SVG),
 *  - dimension cap, then re-encoded through a canvas to a clean PNG so no
 *    original bytes (metadata, polyglot payloads) ever reach an export.
 *
 * Depends on: jQuery, ui/state.js; showMessage()/updatePreview() from app.js at event time
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

function clearLogo() {
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

function acceptNormalizedLogo(img) {
  const scale = Math.min(1, LOGO_NORMALIZED_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/png");

  const clean = new Image();
  clean.onload = function() {
    logoImage = clean;
    logoDataUrl = dataUrl;
    $("#logoPreview").empty().append($("<img>").attr({ src: dataUrl, alt: t("logoPreviewAlt") }));
    $("#removeLogo").show();
    $("#logoExtras").show();
    updatePreview();
  };
  clean.onerror = function() { rejectLogo("logoErrRead"); };
  clean.src = dataUrl;
}

$("#logoFile").on("change", function(e) {
  const file = e.target.files && e.target.files[0];
  showMessage("#logoError", null);
  if (!file) return;
  if (file.size > LOGO_MAX_BYTES) { rejectLogo("logoErrSize"); return; }

  file.arrayBuffer().then(function(buf) {
    const mime = sniffImageMime(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    if (!mime) { rejectLogo("logoErrType"); return; }

    const blobUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
    const img = new Image();
    img.onload = function() {
      URL.revokeObjectURL(blobUrl);
      if (!img.naturalWidth || img.naturalWidth > LOGO_MAX_DIMENSION || img.naturalHeight > LOGO_MAX_DIMENSION) {
        rejectLogo("logoErrDims");
        return;
      }
      acceptNormalizedLogo(img);
    };
    img.onerror = function() {
      URL.revokeObjectURL(blobUrl);
      rejectLogo("logoErrRead");
    };
    img.src = blobUrl;
  }).catch(function() { rejectLogo("logoErrRead"); });
});

$("#removeLogo").on("click", function() {
  clearLogo();
  showMessage("#logoError", null);
  updatePreview();
});
