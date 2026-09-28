"use strict";

/* =========================================================================
 * Accessible colour picker
 *
 * Swatch button + palette popover + hex field, named via the visible caption.
 *
 * Depends on: jQuery, core/util.js, ui/i18n.js
 * ========================================================================= */

const COLOR_PALETTE = [
  "#1a1a1a", "#4b5563", "#0f172a", "#1e3a5f",
  "#0f766e", "#166534", "#854d0e", "#7c2d12",
  "#991b1b", "#9d174d", "#6b21a8", "#4338ca",
  "#0369a1", "#0891b2", "#65a30d", "#ca8a04",
  "#ea580c", "#e11d48", "#ffffff", "#f3f4f6"
];

function setupColorPicker(name) {
  const swatchBtn = $("#" + name + "Swatch");
  const hiddenInput = $("#" + name);
  const popover = $("#" + name + "Popover");
  const grid = $("#" + name + "Grid");
  const hexInput = $("#" + name + "Hex");

  const caption = $("#" + name + "Caption");
  swatchBtn.attr({ "aria-expanded": "false", "aria-controls": name + "Popover" });

  function currentHex() {
    return sanitizeHex(hiddenInput.val(), "#000000").slice(1);
  }

  function refreshUI() {
    const hex = currentHex();
    swatchBtn.css("background", "#" + hex);
    // e.g. "QR color: #000000, pick color" — the caption tells which of the five pickers this is.
    swatchBtn.attr({ "aria-label": caption.text() + ": #" + hex + ", " + t("pickColor"), "title": "#" + hex });
    hexInput.attr("aria-label", t("hexCodeLabel") + ", " + caption.text());
    if (document.activeElement !== hexInput[0]) hexInput.val(hex);
    grid.find("button").each(function() {
      const selected = $(this).attr("data-hex") === hex;
      $(this).toggleClass("selected", selected).attr("aria-pressed", String(selected));
    });
  }

  function setColor(hex) {
    hiddenInput.val("#" + hex.toLowerCase()).trigger("change");
  }

  // Keep the swatch in sync no matter who changes the value.
  hiddenInput.on("change", refreshUI);

  function close() {
    popover.removeClass("open");
    swatchBtn.attr("aria-expanded", "false");
  }

  COLOR_PALETTE.forEach(function(hex) {
    const clean = hex.slice(1).toLowerCase();
    $("<button type='button'></button>")
      .css("background", hex)
      .attr({ "data-hex": clean, "aria-label": hex, "title": hex })
      .on("click", function() { setColor(clean); })
      .appendTo(grid);
  });

  swatchBtn.on("click", function(e) {
    e.stopPropagation();
    const open = !popover.hasClass("open");
    $(".color-popover.open").not(popover).removeClass("open");
    $(".color-swatch-btn").not(swatchBtn).attr("aria-expanded", "false");
    popover.toggleClass("open", open);
    swatchBtn.attr("aria-expanded", String(open));
  });

  popover.on("click", function(e) { e.stopPropagation(); });
  popover.on("keydown", function(e) {
    if (e.key === "Escape") { close(); swatchBtn.trigger("focus"); }
  });

  hexInput.on("input", function() {
    const val = $(this).val().replace("#", "");
    if (isValidHex(val)) setColor(val);
  });

  $(document).on("click", close);
  $(document).on("i18n:applied", refreshUI);

  refreshUI();
}
