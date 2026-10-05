"use strict";

/* =========================================================================
 * Internationalisation and language picker
 *
 * Strings live in lang/<code>.js (I18N.<code> = {...}).
 * The start language follows ?lang=xx, then the saved choice, then the browser's
 * languages, then English (see resolveLanguage() in core/util.js).
 *
 * Depends on: jQuery, lang/*.js, core/util.js; updatePreview() from app.js at click time
 * ========================================================================= */

// Only the two-letter language code is stored, locally in this browser; it is never sent anywhere.
const LANG_STORAGE_KEY = "offline-qr-tools.lang";
const FALLBACK_LANG = "en";

// localStorage can be unavailable (privacy modes, some file:// setups): never let that break the app.
function readSavedLang() {
  try { return window.localStorage.getItem(LANG_STORAGE_KEY); } catch (e) { return null; }
}

function saveLang(code) {
  try { window.localStorage.setItem(LANG_STORAGE_KEY, code); } catch (e) { /* not critical */ }
}

function detectStartLanguage() {
  let urlLang = null;
  try { urlLang = new URLSearchParams(window.location.search).get("lang"); } catch (e) { /* ignore */ }
  return resolveLanguage({
    available: Object.keys(I18N),
    urlLang: urlLang,
    saved: readSavedLang(),
    browser: navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language],
    fallback: FALLBACK_LANG
  });
}

let currentLang = detectStartLanguage();

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || (I18N[FALLBACK_LANG] && I18N[FALLBACK_LANG][key]) || key;
}

function applyI18n() {
  $("[data-i18n]").each(function() {
    $(this).text(t($(this).attr("data-i18n")));
  });
  $("[data-i18n-placeholder]").each(function() {
    $(this).attr("placeholder", t($(this).attr("data-i18n-placeholder")));
  });
  document.documentElement.lang = currentLang;
  document.title = t("title");
  // Keep the show/hide button in its current state, only translate the label.
  const isPwdHidden = $("#pswd").attr("type") === "password";
  $("#togglePwd").text(isPwdHidden ? t("show") : t("hide"));
  $(document).trigger("i18n:applied");
}

// The language picker is built from whichever lang/*.js files are loaded in <head>.
// To add a language: create lang/xx.js (with "langName" and "flagCode"), add the flag as
// assets/flags/<flagCode>.svg and add a <script src="lang/xx.js"> line — nothing else.
// Flags are local files: the app must never contact a third-party host.
const FLAG_FALLBACK = "assets/flags/un.svg";

function flagUrl(code) {
  return /^[a-z]{2}$/.test(code || "") ? "assets/flags/" + code + ".svg" : FLAG_FALLBACK;
}

// Falls back to a neutral icon (once) if a language ships without its flag file.
function flagImg(img, code) {
  return $(img)
    .off("error.flag")
    .one("error.flag", function() { this.src = FLAG_FALLBACK; })
    .attr("src", flagUrl(code));
}

function updateLangButton() {
  const entry = I18N[currentLang] || {};
  flagImg("#langBtnFlag", entry.flagCode).attr("alt", "");
  $("#langBtnName").text(entry.langName || currentLang).attr("lang", currentLang);
  $("#langPopover .lang-option").each(function() {
    if ($(this).attr("data-code") === currentLang) $(this).attr("aria-current", "true");
    else $(this).removeAttr("aria-current");
  });
}

function populateLangSelect() {
  const popover = $("#langPopover").empty();
  Object.keys(I18N).sort().forEach(function(code) {
    const entry = I18N[code] || {};
    const btn = $("<button type='button' class='lang-option'></button>")
      .attr("data-code", code)
      .append(flagImg($("<img alt=''>"), entry.flagCode))
      // Each language name is written in its own language (WCAG 3.1.2 language of parts).
      .append($("<span></span>").attr("lang", code).text(entry.langName || code));
    btn.on("click", function() {
      currentLang = code;
      saveLang(code); // a manual choice wins over the browser language next time
      updateLangButton();
      closeLangPopover();
      applyI18n();
      updatePreview();
      // The chosen option disappears with the popover; keyboard focus returns to the button.
      $("#langBtn").trigger("focus");
    });
    popover.append(btn);
  });
  updateLangButton();
}

function closeLangPopover() {
  $("#langPopover").removeClass("open");
  $("#langBtn").attr("aria-expanded", "false");
}

populateLangSelect();

$("#langBtn").on("click", function(e) {
  e.stopPropagation();
  const open = !$("#langPopover").hasClass("open");
  $("#langPopover").toggleClass("open", open);
  $(this).attr("aria-expanded", String(open));
});
$("#langPopover").on("click", function(e) { e.stopPropagation(); });
$(document).on("click", closeLangPopover);
// Tabbing out of the open list closes it (otherwise Escape no longer reaches it).
$("#langPicker").on("focusout", function(e) {
  if (e.relatedTarget && !this.contains(e.relatedTarget)) closeLangPopover();
});
$("#langPicker").on("keydown", function(e) {
  if (e.key === "Escape" && $("#langPopover").hasClass("open")) {
    closeLangPopover();
    $("#langBtn").trigger("focus");
  }
});
