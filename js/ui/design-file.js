"use strict";

/* =========================================================================
 * Save / open design files
 *
 * Writes the current appearance to a .json file and applies such a file again.
 * Format, validation and the security rules are in core/design.js: only appearance is
 * stored (never content or texts), every imported value is validated, and an imported
 * logo goes through the hardened logo pipeline (decodeLogoBuffer() in ui/logo.js).
 *
 * Depends on: jQuery, core/design.js, ui/state.js, ui/logo.js;
 *             showMessage(), updatePreview(), triggerDownload() from app.js at event time
 * ========================================================================= */

const DESIGN_FILE_NAME = "qr-design.json";

// Allowed values for every enum field = the options that exist in the form right now.
function designEnumOptions() {
  const out = {};
  Object.keys(DESIGN_FIELDS).forEach(function(key) {
    if (DESIGN_FIELDS[key].kind !== "enum") return;
    out[key] = $("#" + key + " option").map(function() { return this.value; }).get();
  });
  return out;
}

function readDesignControls() {
  const values = {};
  Object.keys(DESIGN_FIELDS).forEach(function(key) {
    const el = $("#" + key);
    const kind = DESIGN_FIELDS[key].kind;
    if (kind === "bool") values[key] = el.is(":checked");
    else if (kind === "int") values[key] = parseInt(el.val(), 10);
    else if (kind === "hex") values[key] = sanitizeHex(el.val(), "#000000");
    else values[key] = String(el.val());
  });
  return values;
}

// Applies one field at a time, in DESIGN_FIELDS order, so change handlers that adjust
// other controls (e.g. the Polaroid paper colour) run before those controls are set.
function applyDesignControls(style) {
  Object.keys(DESIGN_FIELDS).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(style, key)) return;
    const el = $("#" + key);
    if (DESIGN_FIELDS[key].kind === "bool") el.prop("checked", style[key]);
    else el.val(String(style[key]));
    el.trigger("change");
  });
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function updateDesignLogoOption() {
  $("#designLogoWrap").toggle(Boolean(logoDataUrl));
}
$(document).on("preview:rendered", updateDesignLogoOption);

$("#saveDesign").on("click", function() {
  const includeLogo = Boolean(logoDataUrl) && $("#designIncludeLogo").is(":checked");
  const design = buildDesign(readDesignControls(), includeLogo ? logoDataUrl : null);
  const url = URL.createObjectURL(new Blob([JSON.stringify(design, null, 2)], { type: "application/json" }));
  triggerDownload(url, DESIGN_FILE_NAME);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  showMessage("#designStatus", "designSaved");
});

$("#designFile").on("change", function(e) {
  const file = e.target.files && e.target.files[0];
  $(this).val(""); // allows opening the same file again
  showMessage("#designStatus", null);
  showMessage("#designError", null);
  if (!file) return;
  // Checked before reading so a huge file is never loaded into memory.
  if (file.size > DESIGN_MAX_FILE_BYTES) { showMessage("#designError", "errDesignSize"); return; }

  file.text().then(function(text) {
    const result = parseDesignFile(text, designEnumOptions());
    if (result.error) { showMessage("#designError", result.error); return; }
    // The logo is decoded and checked before anything is applied, so a file with a bad logo
    // changes nothing (errDesignLogo says so). Without a logo the current logo is kept.
    const logo = result.logoBase64 ? decodeLogoBuffer(base64ToArrayBuffer(result.logoBase64)) : Promise.resolve(null);
    return logo.then(function(decoded) {
      applyDesignControls(result.style);
      if (decoded) useDecodedLogo(decoded);
      updatePreview();
      showMessage("#designStatus", result.skipped ? "designOpenedPartly" : "designOpened");
    }, function() {
      showMessage("#designError", "errDesignLogo");
    });
  }).catch(function() { showMessage("#designError", "errDesignInvalid"); });
});
