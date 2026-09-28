"use strict";

/* =========================================================================
 * App controller
 *
 * Wires the form to the payload builder, preview, self-test and downloads.
 * Loaded after all other modules (see index.html for the order).
 *
 * Depends on: all js/core, js/render and js/ui modules
 * ========================================================================= */

const PREVIEW_SIZE = 640; // rendered at 2x and scaled down by CSS for a sharp preview

function renderPreview() {
  if (!currentQR) return;
  const scene = buildScene(currentQR, PREVIEW_SIZE, getRenderOpts());
  const canvas = sceneToCanvas(scene);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("qrPreviewAlt"));
  $("#qrcode").empty().append(canvas);
  $("#textContrastWarning").toggle(scene.lowTextContrast);

  if (isDemo || !currentPayload) setScanStatus(null);
  else scheduleScanCheck(canvas, scene.cell, currentPayload);

  // Lets other modules (print layouts) follow design and payload changes.
  $(document).trigger("preview:rendered");
}


/* ---- Form handling ------------------------------------------------------ */

function updatePwdVisibility() {
  const sec = $("#security").val();
  $("#pwd-field").toggle(sec !== "nopass");
  $("#eap-fields").toggle(sec === "WPA2-EAP");
  $("#hidden").closest("label").toggle(sec !== "WPA2-EAP");
}
$("#security").on("change", updatePwdVisibility);
updatePwdVisibility();

$("#togglePwd").on("click", function() {
  const field = $("#pswd");
  const isPwd = field.attr("type") === "password";
  field.attr("type", isPwd ? "text" : "password");
  $(this).text(isPwd ? t("hide") : t("show")).attr("aria-pressed", String(isPwd));
});

$("#anonIdentity").on("change", function() {
  $("#identity").prop("disabled", $(this).is(":checked"));
});

function currentTemplate() {
  return FRAME_TEMPLATES[$("#frameStyle").val()] || FRAME_TEMPLATES.none;
}

function updateStyleVisibility() {
  const frame = $("#frameStyle").val();
  const textStyle = $("#textStyle").val();
  const owns = currentTemplate().ownsText;
  $("#frameColorWrap").toggle(frame !== "none");
  $("#textExtras").toggle(textStyle !== "none");
  $("#textBgColorWrap").toggle(textStyle === "banner" && !owns);
  $("#textOwnedHint").toggle(owns);
}
$("#frameStyle, #textStyle").on("change", updateStyleVisibility);
updateStyleVisibility();

$("#autoTextColor").on("change", function() {
  $("#manualTextColorWrap").toggle(!$(this).is(":checked"));
});

function checkQrContrast() {
  const diff = Math.abs(relativeLuminance($("#qrColor").val()) - relativeLuminance($("#qrBgColor").val()));
  $("#contrastWarning").toggle(diff < 0.4);
}

// SECURITY: the password must never appear as readable text on any output. The app never
// renders it itself, but a user could type it into the heading or caption by mistake.
const PASSWORD_ECHO_MIN_LENGTH = 4; // shorter strings match too many ordinary words

function checkPasswordInText() {
  const pswd = $("#pswd").val();
  const visibleText = ($("#titleText").val() + "\n" + $("#captionText").val()).toLowerCase();
  const leaked = $("#textStyle").val() !== "none" && pswd.length >= PASSWORD_ECHO_MIN_LENGTH &&
    visibleText.indexOf(pswd.toLowerCase()) >= 0;
  $("#textPasswordWarning").toggle(leaked);
}

// Shows a translatable message; the data-i18n key keeps it in sync on language change.
const ERROR_FIELDS = { errSsidTooLong: "#ssid", errPswdWpa: "#pswd", errPswdWep: "#pswd" };

// Marks the offending field invalid and points it at the message, so screen readers
// announce the reason when the field is focused.
function setFieldError(key) {
  $("#ssid, #pswd").removeAttr("aria-invalid").each(function() {
    const ids = ($(this).attr("aria-describedby") || "").split(" ").filter(function(id) { return id && id !== "formError"; });
    if (ids.length) $(this).attr("aria-describedby", ids.join(" ")); else $(this).removeAttr("aria-describedby");
  });
  const field = key && ERROR_FIELDS[key];
  if (field) {
    const ids = ($(field).attr("aria-describedby") || "").split(" ").filter(Boolean).concat("formError");
    $(field).attr({ "aria-invalid": "true", "aria-describedby": ids.join(" ") });
  }
}

function showMessage(selector, key) {
  const el = $(selector);
  if (key) el.attr("data-i18n", key).text(t(key)).show();
  else el.removeAttr("data-i18n").text("").hide();
}

/* ---- Export settings ---------------------------------------------------- */

function updateExportFieldsVisibility() {
  const isPdf = $("#exportFormat").val() === "pdf";
  $("#pixelSizeWrap").toggle(!isPdf);
  $("#customSizeWrap").toggle(!isPdf && $("#exportSize").val() === "custom");
  $("#pdfExtras").toggle(isPdf);
}
$("#exportFormat").on("change", updateExportFieldsVisibility);
updateExportFieldsVisibility();

$("#exportSize").on("change", function() {
  $("#customSizeWrap").toggle($(this).val() === "custom");
});

function getExportSize() {
  const sel = $("#exportSize").val();
  if (sel === "custom") {
    const v = parseInt($("#customSize").val(), 10);
    if (isNaN(v)) return 900;
    return Math.max(100, Math.min(4000, v));
  }
  return parseInt(sel, 10);
}

function getRenderOpts() {
  const textStyle = $("#textStyle").val();
  const showText = textStyle !== "none";
  let caption = "";
  if (showText) {
    caption = $("#captionText").val().trim() || (currentSSID ? t("scanToConnect") + currentSSID : "");
  }
  const scale = parseFloat($("#textSize").val());
  const shape = $("#qrShape").val();

  return {
    frameStyle: FRAME_TEMPLATES[$("#frameStyle").val()] ? $("#frameStyle").val() : "none",
    frameColor: sanitizeHex($("#frameColor").val(), "#1a1a1a"),
    textStyle: textStyle,
    textBgColor: sanitizeHex($("#textBgColor").val(), "#1a1a1a"),
    title: showText ? $("#titleText").val().trim() : "",
    caption: caption,
    textColorOverride: showText && !$("#autoTextColor").is(":checked") ? sanitizeHex($("#textColor").val(), "#ffffff") : null,
    textSizeScale: scale >= 0.5 && scale <= 3 ? scale : 1.2,
    wifiIcon: $("#wifiIcon").is(":checked"),
    qrShape: ["square", "rounded", "dots"].indexOf(shape) >= 0 ? shape : "square",
    qrColor: sanitizeHex($("#qrColor").val(), "#000000"),
    qrBgColor: sanitizeHex($("#qrBgColor").val(), "#ffffff"),
    logoSizePercent: Math.max(10, Math.min(30, parseInt($("#logoSize").val(), 10) || 20)),
    logoBgWhite: $("#logoBgWhite").is(":checked"),
    logoImage: logoImage,
    logoDataUrl: logoDataUrl
  };
}

/* ---- Payload ------------------------------------------------------------ */

// Reads the form; all rules live in the pure buildWifiPayload() (core/payload.js).
function buildPayload() {
  return buildWifiPayload({
    ssid: $("#ssid").val(),
    password: $("#pswd").val(),
    security: $("#security").val(),
    hidden: $("#hidden").is(":checked"),
    eapMethod: $("#eapMethod").val(),
    phase2: $("#phase2").val(),
    anonymous: $("#anonIdentity").is(":checked"),
    identity: $("#identity").val()
  });
}

function showDemo() {
  try {
    const demo = qrcode(0, "H");
    demo.addData("WIFI:T:WPA;S:" + escapeWifi(t("demoSsid")) + ";P:demo1234;;");
    demo.make();
    currentQR = demo;
    currentPayload = null;
    currentSSID = t("demoSsid");
    isDemo = true;
    $("#demoLabel").show();
    $("#download").prop("disabled", true);
    renderPreview();
  } catch (e) {
    // The demo QR is cosmetic; ignore failures.
  }
}

function updatePreview() {
  checkQrContrast();
  checkPasswordInText();
  const result = buildPayload();

  if (result.error) {
    showMessage("#formError", result.visible ? result.error : null);
    setFieldError(result.visible ? result.error : null);
    showDemo();
    return;
  }
  showMessage("#formError", null);
  setFieldError(null);

  let qr;
  try {
    qr = qrcode(0, "H");
    qr.addData(result.payload);
    qr.make();
  } catch (e) {
    $("#qrcode").empty().append($("<span class='qr-error'></span>").text(t("errorTooLong")));
    $("#demoLabel").hide();
    $("#download").prop("disabled", true);
    currentQR = null;
    currentPayload = null;
    setScanStatus(null);
    return;
  }

  currentQR = qr;
  currentPayload = result.payload;
  currentSSID = result.ssid;
  isDemo = false;
  $("#demoLabel").hide();
  renderPreview();
  $("#download").prop("disabled", false);
}

setupColorPicker("qrColor");
setupColorPicker("qrBgColor");
setupColorPicker("frameColor");
setupColorPicker("textBgColor");
setupColorPicker("textColor");

// Free-text fields are debounced; discrete controls update immediately.
const updatePreviewDebounced = debounce(updatePreview, 150);
$("#ssid, #pswd, #identity, #titleText, #captionText").on("input", updatePreviewDebounced);
$("#security, #eapMethod, #phase2, #anonIdentity, #hidden, #qrShape, #qrColor, #qrBgColor, #frameStyle, #frameColor, " +
  "#textStyle, #textBgColor, #textSize, #autoTextColor, #textColor, #wifiIcon, #logoSize, #logoBgWhite").on("input change", updatePreview);

$(document).on("i18n:applied", function() { $("#logoPreview img").attr("alt", t("logoPreviewAlt")); });

// Screen readers announce "20 %" instead of a bare number.
$("#logoSize").on("input change", function() { $(this).attr("aria-valuetext", $(this).val() + " %"); });

$(document).ready(function() {
  applyI18n();
  updatePreview();
});

/* ---- Download ----------------------------------------------------------- */

function triggerDownload(href, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = href;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

$("#download").on("click", function() {
  if (!currentQR || isDemo) return;
  if (lastScanStatus === "fail" && !window.confirm(t("scanFailConfirm"))) return;
  const format = $("#exportFormat").val();
  const opts = getRenderOpts();

  if (format === "svg") {
    const svgStr = sceneToSVG(buildScene(currentQR, getExportSize(), opts));
    const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml" }));
    triggerDownload(url, "wifi-qr.svg");
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } else if (format === "pdf") {
    if (!window.jspdf) {
      alert(t("pdfLibError"));
      return;
    }
    const canvas = sceneToCanvas(buildScene(currentQR, 1600, opts));
    const dataUrl = canvas.toDataURL("image/png");

    const widthMM = Math.max(20, Math.min(250, parseFloat($("#pdfWidthMM").val()) || 80));
    const heightMM = widthMM * (canvas.height / canvas.width);

    const doc = new window.jspdf.jsPDF({ orientation: $("#pdfOrientation").val(), unit: "mm", format: $("#pdfPaper").val() });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    // "SLOW" = maximum deflate. Without an explicit compression jsPDF 4 embeds the
    // bitmap uncompressed (~7.7 MB for a 1600 px render instead of ~25 kB).
    doc.addImage(dataUrl, "PNG", (pageW - widthMM) / 2, (pageH - heightMM) / 2, widthMM, heightMM, undefined, "SLOW");
    doc.save("wifi-qr.pdf");
  } else {
    const canvas = sceneToCanvas(buildScene(currentQR, getExportSize(), opts));
    triggerDownload(canvas.toDataURL("image/png"), "wifi-qr.png");
  }
});
