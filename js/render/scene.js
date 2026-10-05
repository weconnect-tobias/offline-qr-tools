"use strict";

/* =========================================================================
 * Scene model: primitives and text layout
 *
 * A template describes the artwork as a flat list of primitives:
 *   rect   { x, y, w, h, fill }
 *   path   { d, fill?, stroke?, lineWidth?, dash?, cap? }   (SVG path syntax)
 *   circle { cx, cy, r, fill }
 *   text   { x, y, text, size, bold, fill }                  (centered)
 *   image  { x, y, w, h, img, href }
 * sceneToCanvas() and sceneToSVG() (render/renderer.js) translate the same list, so a new
 * style is written once and PNG, PDF and SVG exports always match.
 *
 * Depends on: core/util.js; a browser canvas for text measurement
 * ========================================================================= */

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const QUIET_ZONE_MODULES = 4; // ISO/IEC 18004 minimum quiet zone

// Wi-Fi symbol (three arcs and a dot) centered on (cx, cy), fitting a box of size s.
function wifiIconItems(cx, cy, s, color) {
  const y0 = cy + s * 0.32;
  let d = "";
  [0.26, 0.5, 0.74].forEach(function(k) {
    const r = s * k;
    const dx = r * Math.SQRT1_2;
    d += "M" + f(cx - dx) + " " + f(y0 - dx) + "A" + f(r) + " " + f(r) + " 0 0 1 " + f(cx + dx) + " " + f(y0 - dx);
  });
  return [
    { type: "path", d: d, stroke: color, lineWidth: s * 0.1, cap: "round" },
    { type: "circle", cx: cx, cy: y0, r: s * 0.085, fill: color }
  ];
}

const _measureCtx = document.createElement("canvas").getContext("2d");

function measureTextWidth(text, px, bold) {
  _measureCtx.font = (bold ? "bold " : "") + px + "px " + FONT_FAMILY;
  return _measureCtx.measureText(text).width;
}

// Shrinks the font down to 45 % of the base size, then truncates with an ellipsis.
function fitText(text, basePx, maxWidth, bold) {
  let size = basePx;
  const minSize = basePx * 0.45;
  while (measureTextWidth(text, size, bold) > maxWidth && size > minSize) size -= Math.max(1, basePx * 0.02);
  if (measureTextWidth(text, size, bold) <= maxWidth) return { text: text, size: size };
  // Cut whole characters (code points), so an emoji is never split into a broken half.
  const chars = Array.from(text);
  while (chars.length > 1 && measureTextWidth(chars.join("") + "…", size, bold) > maxWidth) chars.pop();
  return { text: chars.join("") + "…", size: size };
}

// Builds centered text (optionally with a Wi-Fi icon) and records contrast problems.
function makeText(state, spec) {
  // Line breaks and tabs become spaces, and characters XML cannot hold are dropped here, so
  // the canvas (PNG/PDF) and the SVG export show exactly the same text.
  const raw = toWellFormed(spec.text || "").replace(/[\t\n\r]+/g, " ")
    .replace(/[\u0000-\u001F\u007F\uFFFE\uFFFF]/g, "").trim();
  if (!raw && !spec.icon) return [];

  const fill = spec.color || contrastTextColor(spec.bg);
  if (Math.abs(relativeLuminance(fill) - relativeLuminance(spec.bg)) < 0.4) state.lowTextContrast = true;

  let iconS = spec.icon ? spec.basePx * 1.2 : 0;
  let gap = spec.icon && raw ? spec.basePx * 0.45 : 0;
  const fitted = raw ? fitText(raw, spec.basePx, spec.maxWidth - iconS - gap, spec.bold) : { text: "", size: spec.basePx };
  const scale = fitted.size / spec.basePx;
  iconS *= scale;
  gap *= scale;

  const textW = fitted.text ? measureTextWidth(fitted.text, fitted.size, spec.bold) : 0;
  const total = iconS + gap + textW;
  const x0 = spec.cx - total / 2;
  const boxH = Math.max(fitted.size, iconS) * 1.2;
  const bbox = { x: x0, y: spec.cy - boxH / 2, w: total, h: boxH };

  const items = [];
  if (spec.icon) items.push.apply(items, wifiIconItems(x0 + iconS / 2, spec.cy, iconS, fill));
  if (fitted.text) {
    items.push({ type: "text", x: x0 + iconS + gap + textW / 2, y: spec.cy, text: fitted.text, size: fitted.size, bold: !!spec.bold, fill: fill });
  }
  items.forEach(function(it) { it.bbox = bbox; });
  return items;
}
