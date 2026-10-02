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

/* ---- QR style: shape registries, gradient, eye colour, presets ---------- */

const SHAPE_REGISTRIES = { MODULE_SHAPES: MODULE_SHAPES, EYE_STYLES: EYE_STYLES };

// Options come from the registries, so a new shape needs no HTML change. Labels are
// filled in by applyI18n() through data-i18n.
$("select[data-registry]").each(function() {
  const select = $(this);
  const registry = SHAPE_REGISTRIES[select.attr("data-registry")] || {};
  Object.keys(registry).forEach(function(id) {
    $("<option></option>").val(id).attr("data-i18n", registry[id].labelKey).text(registry[id].labelKey).appendTo(select);
  });
  select.val("square");
});

function updateQrStyleVisibility() {
  $("#gradientColor2Wrap").toggle($("#gradient").val() !== "none");
  $("#gradientAngleWrap").toggle($("#gradient").val() === "angle");
  $("#eyeColorWrap").toggle($("#customEyeColor").is(":checked"));
}
$("#gradient, #customEyeColor").on("change", updateQrStyleVisibility);
updateQrStyleVisibility();

// Shows the angle next to the label; screen readers announce "45°" instead of a bare number.
$("#gradientAngle").on("input change", function() {
  const label = normalizeAngle($(this).val()) + "°";
  $(this).attr("aria-valuetext", label);
  $("#gradientAngleValue").text(label);
});

// Presets only set shape/gradient controls; colours stay the user's choice.
// Swish's guidelines for own QR codes: black and white, rounded eyes, the Swish symbol
// without wordmark in the middle at 25 % of the code width on its white round background,
// and "Swish" written in text next to it. The colour variant is the 45° purple-to-red
// gradient from Swish's QR design specification (colours taken from the Swish symbol).
// The symbol itself is never bundled (Swish trademark); the user adds it as the logo.
const SWISH_LOOKS = {
  bw: { qrShape: "square", eyeStyle: "rounded", qrColor: "#000000", qrBgColor: "#ffffff", gradient: "none" },
  color: { qrShape: "square", eyeStyle: "rounded", qrColor: "#6835ed", qrBgColor: "#ffffff", gradient: "angle", gradientAngle: "45", gradientColor2: "#f13b30" }
};

function applySwishLook(name) {
  const look = SWISH_LOOKS[name];
  if (!look) return;
  Object.keys(look).forEach(function(id) { $("#" + id).val(look[id]).trigger("change"); });
  $("#customEyeColor").prop("checked", false).trigger("change");
  $("#logoSize").val("25").trigger("change");
  $("#logoBackground").val("clear").trigger("change");
  // The symbol may only be used without the wordmark when "Swish" is written in text.
  if ($("#textStyle").val() === "none") $("#textStyle").val("plain").trigger("change");
  if (!String($("#captionText").val()).trim()) $("#captionText").val(t("ctaPayWithSwish"));
  updateSwishLogoNote();
  updatePreview();
}

function updateSwishLogoNote() {
  $("#swLogoNote").toggle(currentType === "swish" && Boolean($("#swLogoNote").data("lookApplied")) && !logoImage);
}
$("[data-swish-look]").on("click", function() {
  $("#swLogoNote").data("lookApplied", true);
  applySwishLook($(this).attr("data-swish-look"));
});
$(document).on("preview:rendered qrtype:changed", updateSwishLogoNote);

const QR_STYLE_PRESETS = {
  classic: { qrShape: "square", eyeStyle: "square", gradient: "none" },
  modern: { qrShape: "fluid", eyeStyle: "rounded", gradient: "none" },
  elegant: { qrShape: "classy", eyeStyle: "leaf", gradient: "diagonal" },
  playful: { qrShape: "dots", eyeStyle: "circle", gradient: "radial" },
  minimal: { qrShape: "smallSquares", eyeStyle: "roundedDot", gradient: "none" },
  retro: { qrShape: "hlines", eyeStyle: "pointed", gradient: "vertical" }
};

$("[data-preset]").on("click", function() {
  const preset = QR_STYLE_PRESETS[$(this).attr("data-preset")];
  if (!preset) return;
  Object.keys(preset).forEach(function(id) { $("#" + id).val(preset[id]); });
  updateQrStyleVisibility();
  updatePreview();
});

// Polaroid paper looks wrong in the default near-black; switch to white once if untouched.
$("#frameStyle").on("change", function() {
  if ($(this).val() === "polaroid" && $("#frameColor").val() === "#1a1a1a") {
    $("#frameColor").val("#ffffff").trigger("change");
  }
});

$("#autoTextColor").on("change", function() {
  $("#manualTextColorWrap").toggle(!$(this).is(":checked"));
});

// Every colour the modules or eyes can be drawn in must stand out from the background,
// including both ends of a gradient and a custom eye colour.
function checkQrContrast() {
  const o = getRenderOpts();
  const inks = [o.qrColor];
  if (o.gradient !== "none") inks.push(o.gradientColor2);
  if (o.eyeColor) inks.push(o.eyeColor);
  const bg = relativeLuminance(o.qrBgColor);
  const weak = inks.some(function(ink) { return Math.abs(relativeLuminance(ink) - bg) < 0.4; });
  $("#contrastWarning").toggle(weak);
}

// SECURITY: the password must never appear as readable text on any output. The app never
// renders it itself, but a user could type it into the heading or caption by mistake.
const PASSWORD_ECHO_MIN_LENGTH = 4; // shorter strings match too many ordinary words

function checkPasswordInText() {
  const pswd = currentType === "wifi" ? $("#pswd").val() : "";
  const visibleText = ($("#titleText").val() + "\n" + $("#captionText").val()).toLowerCase();
  const leaked = $("#textStyle").val() !== "none" && pswd.length >= PASSWORD_ECHO_MIN_LENGTH &&
    visibleText.indexOf(pswd.toLowerCase()) >= 0;
  $("#textPasswordWarning").toggle(leaked);
}

// Which field an error belongs to, per QR type (several types share error keys).
const ERROR_FIELDS = {
  wifi: { errSsidTooLong: "#ssid", errPswdWpa: "#pswd", errPswdWep: "#pswd" },
  url: { errUrlInvalid: "#urlInput", errUrlScheme: "#urlInput", errUrlCredentials: "#urlInput", errUrlTooLong: "#urlInput" },
  text: { errTextTooLong: "#qrText" },
  email: { errEmailInvalid: "#emailTo", errTextTooLong: "#emailBody" },
  phone: { errPhoneInvalid: "#phoneNumber" },
  sms: { errPhoneInvalid: "#smsNumber", errTextTooLong: "#smsMessage" },
  vcard: { errPhoneInvalid: "#vcPhone", errEmailInvalid: "#vcEmail", errUrlInvalid: "#vcUrl", errUrlScheme: "#vcUrl", errUrlCredentials: "#vcUrl", errUrlTooLong: "#vcUrl", errTextTooLong: "#vcNote" },
  geo: { errGeoInvalid: "#geoLat" },
  swish: { errSwishNumber: "#swNumber", errSwishAmount: "#swAmount", errSwishMessage: "#swMessage" },
  event: { errEventStart: "#evStartDate", errEventEnd: "#evEndDate", errTextTooLong: "#evDescription" }
};

// Marks the offending field invalid and points it at the message, so screen readers
// announce the reason when the field is focused.
function setFieldError(key) {
  $(".type-panel input, .type-panel textarea").removeAttr("aria-invalid").each(function() {
    const ids = ($(this).attr("aria-describedby") || "").split(" ").filter(function(id) { return id && id !== "formError"; });
    if (ids.length) $(this).attr("aria-describedby", ids.join(" ")); else $(this).removeAttr("aria-describedby");
  });
  const field = key && (ERROR_FIELDS[currentType] || {})[key];
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
  $("#transparentWrap").toggle(!isPdf);
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

// Default caption per type, e.g. "Scan to open example.com". Built from the summary,
// which never contains a secret (see core/qr-types.js).
function defaultCaption() {
  const key = "caption" + currentType.charAt(0).toUpperCase() + currentType.slice(1);
  return currentSummary ? t(key).replace("{x}", currentSummary) : "";
}

// Select values are whitelisted against the shape registries (js/render/shapes.js).
function registryValue(registry, value) {
  return Object.prototype.hasOwnProperty.call(registry, value) ? value : "square";
}

function getRenderOpts() {
  const textStyle = $("#textStyle").val();
  const showText = textStyle !== "none";
  let caption = "";
  if (showText) {
    caption = $("#captionText").val().trim() || defaultCaption();
  }
  const scale = parseFloat($("#textSize").val());
  const qrColor = sanitizeHex($("#qrColor").val(), "#000000");

  return {
    frameStyle: FRAME_TEMPLATES[$("#frameStyle").val()] ? $("#frameStyle").val() : "none",
    frameColor: sanitizeHex($("#frameColor").val(), "#1a1a1a"),
    textStyle: textStyle,
    textBgColor: sanitizeHex($("#textBgColor").val(), "#1a1a1a"),
    title: showText ? $("#titleText").val().trim() : "",
    caption: caption,
    textColorOverride: showText && !$("#autoTextColor").is(":checked") ? sanitizeHex($("#textColor").val(), "#ffffff") : null,
    textSizeScale: scale >= 0.5 && scale <= 3 ? scale : 1.2,
    wifiIcon: currentType === "wifi" && $("#wifiIcon").is(":checked"),
    qrShape: registryValue(MODULE_SHAPES, $("#qrShape").val()),
    eyeStyle: registryValue(EYE_STYLES, $("#eyeStyle").val()),
    gradient: GRADIENT_TYPES.indexOf($("#gradient").val()) >= 0 ? $("#gradient").val() : "none",
    gradientColor2: sanitizeHex($("#gradientColor2").val(), qrColor),
    gradientAngle: normalizeAngle($("#gradientAngle").val()),
    eyeColor: $("#customEyeColor").is(":checked") ? sanitizeHex($("#eyeColor").val(), qrColor) : null,
    qrColor: qrColor,
    qrBgColor: sanitizeHex($("#qrBgColor").val(), "#ffffff"),
    logoSizePercent: Math.max(10, Math.min(30, parseInt($("#logoSize").val(), 10) || 20)),
    logoBackground: LOGO_BACKGROUNDS.indexOf($("#logoBackground").val()) >= 0 ? $("#logoBackground").val() : "clear",
    quietZone: QUIET_ZONE_CHOICES.indexOf(parseInt($("#quietZone").val(), 10)) >= 0 ? parseInt($("#quietZone").val(), 10) : QUIET_ZONE_MODULES,
    transparent: false, // only PNG/SVG downloads set this (download handler)
    logoImage: logoImage,
    logoDataUrl: logoDataUrl
  };
}

/* ---- QR type and payload ------------------------------------------------ */

// Reads the active panel. All validation and encoding lives in the pure builders
// (core/qr-types.js and core/payload.js).
const TYPE_READERS = {
  wifi: function() {
    return {
      ssid: $("#ssid").val(), password: $("#pswd").val(), security: $("#security").val(),
      hidden: $("#hidden").is(":checked"), eapMethod: $("#eapMethod").val(), phase2: $("#phase2").val(),
      anonymous: $("#anonIdentity").is(":checked"), identity: $("#identity").val()
    };
  },
  url: function() { return { url: $("#urlInput").val() }; },
  text: function() { return { text: $("#qrText").val() }; },
  email: function() { return { to: $("#emailTo").val(), subject: $("#emailSubject").val(), body: $("#emailBody").val() }; },
  phone: function() { return { number: $("#phoneNumber").val() }; },
  sms: function() { return { number: $("#smsNumber").val(), message: $("#smsMessage").val() }; },
  vcard: function() {
    return {
      firstName: $("#vcFirst").val(), lastName: $("#vcLast").val(), org: $("#vcOrg").val(), title: $("#vcTitle").val(),
      phone: $("#vcPhone").val(), email: $("#vcEmail").val(), url: $("#vcUrl").val(), street: $("#vcStreet").val(),
      zip: $("#vcZip").val(), city: $("#vcCity").val(), country: $("#vcCountry").val(), note: $("#vcNote").val()
    };
  },
  geo: function() { return { lat: $("#geoLat").val(), lon: $("#geoLon").val() }; },
  swish: function() {
    return {
      number: $("#swNumber").val(), amount: $("#swAmount").val(), message: $("#swMessage").val(),
      amountLocked: $("#swAmountLocked").is(":checked"), messageLocked: $("#swMessageLocked").is(":checked")
    };
  },
  event: function() {
    return {
      title: $("#evTitle").val(), location: $("#evLocation").val(), allDay: $("#evAllDay").is(":checked"),
      startDate: $("#evStartDate").val(), startTime: $("#evStartTime").val(),
      endDate: $("#evEndDate").val(), endTime: $("#evEndTime").val(), description: $("#evDescription").val()
    };
  }
};

// Swish lock boxes follow their field (filled = locked, empty = open) until the user
// clicks them; after that the user's choice stands. Like Swish's own generator, an empty
// amount cannot be locked (it is always open), while an empty message can.
function syncSwishLock(field, box) {
  if (!$(box).data("userSet")) $(box).prop("checked", String($(field).val()).trim() !== "");
}
function updateSwishAmountLock() {
  const empty = String($("#swAmount").val()).trim() === "";
  $("#swAmountLocked").prop("disabled", empty);
  if (empty) $("#swAmountLocked").prop("checked", false).removeData("userSet");
  else syncSwishLock("#swAmount", "#swAmountLocked");
}
$("#swAmount").on("input", updateSwishAmountLock);
$("#swMessage").on("input", function() { syncSwishLock("#swMessage", "#swMessageLocked"); });
$("#swAmountLocked, #swMessageLocked").on("click", function() { $(this).data("userSet", true); });
updateSwishAmountLock();

// All-day events have no times.
$("#evAllDay").on("change", function() {
  $(".ev-time").toggle(!$(this).is(":checked"));
});

// Example content shown until the user has filled in the form.
function demoInput(type) {
  switch (type) {
    case "wifi": return { ssid: t("demoSsid"), password: "demo1234", security: "WPA" };
    case "url": return { url: "example.com" };
    case "text": return { text: t("demoText") };
    case "email": return { to: "info@example.com" };
    case "phone": case "sms": return { number: "+46 70 123 45 67" };
    case "vcard": return { firstName: "Anna", lastName: "Svensson" };
    case "geo": return { lat: "58.9395", lon: "11.1712" };
    case "swish": return { number: "1231234567", amount: "100" };
    case "event": return { title: t("demoEventTitle"), startDate: "2026-12-24", startTime: "15:00" };
  }
  return {};
}

function buildPayload() {
  return buildQrPayload(currentType, TYPE_READERS[currentType]());
}

function setQrType(type, options) {
  // Only known ids are accepted; anything else in the address (e.g. injected markup) is replaced.
  if (QR_TYPE_IDS.indexOf(type) < 0) { type = "wifi"; options = { keepHash: false }; }
  currentType = type;
  $("input[name=qrType][value=" + type + "]").prop("checked", true);
  $(".type-panel").each(function() { this.hidden = this.getAttribute("data-type") !== type; });
  // Deep link (index.html#url) without reloading; history.replaceState works on file:// too.
  if (!(options && options.keepHash) && location.hash !== "#" + type) {
    try { history.replaceState(null, "", "#" + type); } catch (e) { /* not critical */ }
  }
  $(document).trigger("qrtype:changed");
}

// Ready-made call-to-action texts for the caption, per content type ("*" = every type).
const CAPTION_SUGGESTIONS = [
  { key: "ctaScanMe", types: "*" },
  { key: "ctaFreeWifi", types: ["wifi"] },
  { key: "ctaGuestWifi", types: ["wifi"] },
  { key: "ctaVisitSite", types: ["url"] },
  { key: "ctaSeeMenu", types: ["url"] },
  { key: "ctaReadMore", types: ["url", "text"] },
  { key: "ctaEmailUs", types: ["email"] },
  { key: "ctaCallUs", types: ["phone"] },
  { key: "ctaTextUs", types: ["sms"] },
  { key: "ctaSaveContact", types: ["vcard"] },
  { key: "ctaFindUs", types: ["geo"] },
  { key: "ctaSaveDate", types: ["event"] },
  { key: "ctaPayWithSwish", types: ["swish"] },
  { key: "ctaSupportUs", types: ["swish"] }
];

function renderCaptionSuggestions() {
  const row = $("#captionSuggestions");
  row.find("button").remove();
  CAPTION_SUGGESTIONS.forEach(function(s) {
    if (s.types !== "*" && s.types.indexOf(currentType) < 0) return;
    $("<button type='button' class='small-btn'></button>").attr({ "data-caption": s.key, "data-i18n": s.key }).text(t(s.key)).appendTo(row);
  });
}
$(document).on("qrtype:changed", renderCaptionSuggestions);

// Fills the caption in the current language; turns text on if it was off.
$("#captionSuggestions").on("click", "button[data-caption]", function() {
  const key = $(this).attr("data-caption");
  if (!CAPTION_SUGGESTIONS.some(function(s) { return s.key === key; })) return;
  if ($("#textStyle").val() === "none") $("#textStyle").val("plain").trigger("change");
  $("#captionText").val(t(key)).trigger("input");
});

// Wi-Fi-only options are hidden for other types.
$(document).on("qrtype:changed", function() {
  $("#wifiIcon").closest("label").toggle(currentType === "wifi");
});

// A logo hides modules, so it always gets the highest level. Without one, "auto" picks Q:
// robust against dirt and wear while keeping the modules larger than with H.
const EC_LEVELS = ["L", "M", "Q", "H"];

function errorCorrectionLevel() {
  if (logoImage) return "H";
  const level = $("#ecLevel").val();
  return EC_LEVELS.indexOf(level) >= 0 ? level : "Q";
}

function updateAdvancedNotes() {
  $("#ecLogoNote").toggle(Boolean(logoImage) && $("#ecLevel").val() !== "auto" && $("#ecLevel").val() !== "H");
  $("#quietZoneNote").toggle($("#quietZone").val() === "2");
}
$(document).on("preview:rendered", updateAdvancedNotes);

function fileBaseName() {
  return "qr-" + currentType;
}

function showDemo() {
  try {
    const demoResult = buildQrPayload(currentType, demoInput(currentType));
    const demo = qrcode(0, errorCorrectionLevel());
    demo.addData(demoResult.payload);
    demo.make();
    currentQR = demo;
    currentPayload = null;
    currentSummary = demoResult.summary;
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

  showMessage("#typeWarning", result.error ? null : result.warning);
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
    qr = qrcode(0, errorCorrectionLevel());
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
  currentSummary = result.summary;
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
setupColorPicker("gradientColor2");
setupColorPicker("eyeColor");

// Free-text fields are debounced; discrete controls update immediately.
const updatePreviewDebounced = debounce(updatePreview, 150);
$(".type-panel").on("input", "input:not([type=checkbox]), textarea", updatePreviewDebounced);
$("#titleText, #captionText").on("input", updatePreviewDebounced);
$("input[name=qrType]").on("change", function() {
  setQrType(this.value);
  updatePreview();
});
$("#security, #eapMethod, #phase2, #anonIdentity, #hidden, #evAllDay, #swAmountLocked, #swMessageLocked, #qrShape, #eyeStyle, #gradient, #gradientAngle, #gradientColor2, " +
  "#customEyeColor, #eyeColor, #qrColor, #qrBgColor, #frameStyle, #frameColor, " +
  "#textStyle, #textBgColor, #textSize, #autoTextColor, #textColor, #wifiIcon, #logoSize, #logoBackground, #quietZone, #ecLevel").on("input change", updatePreview);

$(document).on("i18n:applied", function() { $("#logoPreview img").attr("alt", t("logoPreviewAlt")); });

// Screen readers announce "20 %" instead of a bare number.
$("#logoSize").on("input change", function() { $(this).attr("aria-valuetext", $(this).val() + " %"); });

// Back/forward buttons and links to another #type in the same tab.
$(window).on("hashchange", function() {
  const type = location.hash.slice(1);
  if (type !== currentType) {
    setQrType(type, { keepHash: true });
    updatePreview();
  }
});

$(document).ready(function() {
  setQrType(location.hash.slice(1), { keepHash: true });
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
  // PDF pages are always white paper; transparency only makes sense for PNG and SVG.
  opts.transparent = format !== "pdf" && $("#transparentBg").is(":checked");

  if (format === "svg") {
    const svgStr = sceneToSVG(buildScene(currentQR, getExportSize(), opts));
    const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml" }));
    triggerDownload(url, fileBaseName() + ".svg");
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
    doc.save(fileBaseName() + ".pdf");
  } else {
    const canvas = sceneToCanvas(buildScene(currentQR, getExportSize(), opts));
    triggerDownload(canvas.toDataURL("image/png"), fileBaseName() + ".png");
  }
});
