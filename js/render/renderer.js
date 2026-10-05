"use strict";

/* =========================================================================
 * Scene assembly
 *
 * Depends on: render/scene.js, render/shapes.js, render/templates.js, core/util.js
 * ========================================================================= */

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const QUIET_ZONE_CHOICES = [2, 4, 6];
const LOGO_BACKGROUNDS = ["clear", "plate", "none"];

// Logo size and position in pixels, centred on the code area.
function logoLayout(o, qx, qy, qrSize) {
  const box = qrSize * (o.logoSizePercent / 100);
  const ratio = (o.logoImage.naturalWidth / o.logoImage.naturalHeight) || 1;
  const lw = ratio >= 1 ? box : box * ratio;
  const lh = ratio >= 1 ? box / ratio : box;
  return { box: box, w: lw, h: lh, x: qx + (qrSize - lw) / 2, y: qy + (qrSize - lh) / 2 };
}

// Module test for the area behind the logo: true when the module overlaps the logo plus a
// half-module margin. Structural modules (finders, timing, alignment) are always kept.
function logoClearTest(logo, qx, qy, cell, n) {
  const pad = cell * 0.5;
  const c0 = (logo.x - pad - qx) / cell, c1 = (logo.x + logo.w + pad - qx) / cell;
  const r0 = (logo.y - pad - qy) / cell, r1 = (logo.y + logo.h + pad - qy) / cell;
  return function(row, col) {
    return col + 1 > c0 && col < c1 && row + 1 > r0 && row < r1 && !isStructuralModule(row, col, n);
  };
}

function buildScene(qr, S, o) {
  const k = o.textSizeScale;
  const M = {
    S: S,
    fontTitle: S * 0.05 * k,
    fontCaption: S * 0.04 * k,
    bandH: function(font) { return font * 2.3; }
  };
  const state = { lowTextContrast: false };
  const tx = function(spec) {
    return makeText(state, Object.assign({ color: o.textColorOverride }, spec));
  };

  const tpl = FRAME_TEMPLATES[o.frameStyle] || FRAME_TEMPLATES.none;
  const r = tpl.build(M, o, tx);
  const W = S;
  const H = Math.ceil(r.h);
  const block = r.block;
  const blockRect = { x: block.x, y: block.y, w: block.size, h: block.size };

  if (block.x < 0 || block.y < 0 || block.x + block.size > W + 0.5 || block.y + block.size > H + 0.5) {
    console.error("Template '" + o.frameStyle + "' placed the QR block outside the canvas.");
  }

  // Transparent export: the page and the QR background are left out, so the code can sit on
  // printed material. A block on the template's own paper (card, Polaroid, stamp) keeps its
  // background, otherwise the paper colour would show between the modules.
  const transparent = o.transparent === true;
  const items = [];
  if (r.pageColor && !transparent) items.push({ type: "rect", x: 0, y: 0, w: W, h: H, fill: r.pageColor });
  items.push.apply(items, r.back);

  // QR block: its background covers the full quiet zone, so no decoration can intrude on it.
  const quiet = QUIET_ZONE_CHOICES.indexOf(o.quietZone) >= 0 ? o.quietZone : QUIET_ZONE_MODULES;
  const modCount = qr.getModuleCount();
  const cell = block.size / (modCount + quiet * 2);
  const qx = block.x + cell * quiet;
  const qy = block.y + cell * quiet;
  const qrSize = cell * modCount;
  if (!transparent || tpl.blockOnPaper) {
    items.push({ type: "path", d: roundRectD(block.x, block.y, block.size, block.size, block.radius || 0), fill: o.qrBgColor });
  }

  const hasLogo = Boolean(o.logoImage && o.logoDataUrl);
  const logo = hasLogo ? logoLayout(o, qx, qy, qrSize) : null;
  const logoBg = LOGO_BACKGROUNDS.indexOf(o.logoBackground) >= 0 ? o.logoBackground : "clear";
  const cleared = hasLogo && logoBg === "clear" ? logoClearTest(logo, qx, qy, cell, modCount) : null;

  // Data modules and the three finder patterns ("eyes") are separate paths so the eyes
  // can have their own shape and colour. isData() guards the library's isDark(), which
  // throws outside the matrix, and leaves the finder areas to eyesPathD().
  const isData = function(row, col) {
    return row >= 0 && col >= 0 && row < modCount && col < modCount && !isFinderModule(row, col, modCount) &&
      qr.isDark(row, col) && !(cleared && cleared(row, col));
  };
  const moduleShape = MODULE_SHAPES[o.qrShape] || MODULE_SHAPES.square;
  const paint = qrPaint(o, qx, qy, cell * modCount);
  items.push({ type: "path", d: moduleShape.pathD(isData, modCount, qx, qy, cell), fill: paint });
  items.push({ type: "path", d: eyesPathD(modCount, qx, qy, cell, o.eyeStyle), fill: o.eyeColor || paint, fillRule: "evenodd" });

  // The logo hides or replaces modules; the app always uses error correction level H with a
  // logo to compensate ("clear" removes the modules behind it, "plate" draws a white plate,
  // "none" draws the logo straight on top).
  if (hasLogo) {
    if (logoBg === "plate") {
      const pad = logo.box * 0.09;
      items.push({ type: "path", d: roundRectD(logo.x - pad, logo.y - pad, logo.w + pad * 2, logo.h + pad * 2, logo.box * 0.12), fill: "#ffffff" });
    }
    items.push({ type: "image", x: logo.x, y: logo.y, w: logo.w, h: logo.h, img: o.logoImage, href: o.logoDataUrl });
  }

  r.front.forEach(function(it) {
    if (it.bbox && rectsOverlap(it.bbox, blockRect)) {
      console.warn("Dropped text overlapping the QR block (template '" + o.frameStyle + "').");
      return;
    }
    items.push(it);
  });

  return { w: W, h: H, items: items, cell: cell, lowTextContrast: state.lowTextContrast };
}

/* =========================================================================
 * Renderers
 * ========================================================================= */

// A fill is a colour string or a gradient object from qrPaint() (render/shapes.js).
function canvasPaint(ctx, fill) {
  if (!fill || typeof fill === "string") return fill;
  const g = fill.gradient === "radial"
    ? ctx.createRadialGradient(fill.cx, fill.cy, 0, fill.cx, fill.cy, fill.r)
    : ctx.createLinearGradient(fill.x1, fill.y1, fill.x2, fill.y2);
  g.addColorStop(0, sanitizeHex(fill.stops[0], "#000000"));
  g.addColorStop(1, sanitizeHex(fill.stops[1], "#000000"));
  return g;
}

function sceneToCanvas(scene) {
  const canvas = document.createElement("canvas");
  canvas.width = scene.w;
  canvas.height = scene.h;
  const ctx = canvas.getContext("2d");
  scene.items.forEach(function(it) { drawCanvasItem(ctx, it); });
  return canvas;
}

function drawCanvasItem(ctx, it) {
  switch (it.type) {
    case "rect":
      ctx.fillStyle = it.fill;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      break;
    case "path": {
      const p = new Path2D(it.d);
      if (it.fill) {
        ctx.fillStyle = canvasPaint(ctx, it.fill);
        ctx.fill(p, it.fillRule === "evenodd" ? "evenodd" : "nonzero");
      }
      if (it.stroke) {
        ctx.save();
        ctx.strokeStyle = it.stroke;
        ctx.lineWidth = it.lineWidth || 1;
        ctx.lineCap = it.cap || "butt";
        ctx.setLineDash(it.dash || []);
        ctx.stroke(p);
        ctx.restore();
      }
      break;
    }
    case "circle":
      ctx.fillStyle = it.fill;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "text":
      ctx.fillStyle = it.fill;
      ctx.font = (it.bold ? "bold " : "") + it.size + "px " + FONT_FAMILY;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.text, it.x, it.y);
      break;
    case "image":
      if (it.img && it.img.complete) ctx.drawImage(it.img, it.x, it.y, it.w, it.h);
      break;
  }
}

const SAFE_IMAGE_HREF_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function svgPaint(value, gradientIds) {
  if (value && typeof value === "object") return "url(#" + gradientIds.get(value) + ")";
  return value ? sanitizeHex(value, "#000000") : "none";
}

// <defs> for all gradient fills in the scene. Every value is a number or a sanitised colour.
function svgGradientDefs(scene, gradientIds) {
  const defs = [];
  scene.items.forEach(function(it) {
    const g = it.fill;
    if (!g || typeof g !== "object" || gradientIds.has(g)) return;
    // The id is derived from the gradient itself, so two exported SVGs placed in one web page
    // never pick up each other's gradient (same id = same definition).
    const id = "qrg" + hashHex(JSON.stringify([g.gradient, g.stops, g.x1, g.y1, g.x2, g.y2, g.cx, g.cy, g.r]));
    const known = Array.from(gradientIds.values()).indexOf(id) >= 0;
    gradientIds.set(g, id);
    if (known) return;
    const stops = '<stop offset="0" stop-color="' + sanitizeHex(g.stops[0], "#000000") + '"/><stop offset="1" stop-color="' + sanitizeHex(g.stops[1], "#000000") + '"/>';
    if (g.gradient === "radial") {
      defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + f(g.cx) + '" cy="' + f(g.cy) + '" r="' + f(g.r) + '">' + stops + "</radialGradient>");
    } else {
      defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + f(g.x1) + '" y1="' + f(g.y1) + '" x2="' + f(g.x2) + '" y2="' + f(g.y2) + '">' + stops + "</linearGradient>");
    }
  });
  return defs.length ? "<defs>" + defs.join("") + "</defs>" : "";
}

function sceneToSVG(scene) {
  const out = [];
  const gradientIds = new Map();
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + scene.w + '" height="' + scene.h + '" viewBox="0 0 ' + scene.w + " " + scene.h + '">');
  out.push(svgGradientDefs(scene, gradientIds));
  scene.items.forEach(function(it) {
    switch (it.type) {
      case "rect":
        out.push('<rect x="' + f(it.x) + '" y="' + f(it.y) + '" width="' + f(it.w) + '" height="' + f(it.h) + '" fill="' + svgPaint(it.fill, gradientIds) + '"/>');
        break;
      case "path": {
        let attrs = ' d="' + escapeXml(it.d) + '" fill="' + svgPaint(it.fill, gradientIds) + '"';
        if (it.fillRule === "evenodd") attrs += ' fill-rule="evenodd"';
        if (it.stroke) {
          attrs += ' stroke="' + svgPaint(it.stroke) + '" stroke-width="' + f(it.lineWidth || 1) + '"';
          if (it.cap) attrs += ' stroke-linecap="' + (it.cap === "round" ? "round" : "butt") + '"';
          if (it.dash) attrs += ' stroke-dasharray="' + it.dash.map(f).join(" ") + '"';
        }
        out.push("<path" + attrs + "/>");
        break;
      }
      case "circle":
        out.push('<circle cx="' + f(it.cx) + '" cy="' + f(it.cy) + '" r="' + f(it.r) + '" fill="' + svgPaint(it.fill, gradientIds) + '"/>');
        break;
      case "text":
        // xml:space="preserve" keeps repeated spaces, as the canvas does when it measures and draws.
        out.push('<text xml:space="preserve" x="' + f(it.x) + '" y="' + f(it.y) + '" font-family="' + FONT_FAMILY + '" font-weight="' + (it.bold ? "bold" : "normal") +
          '" font-size="' + f(it.size) + '" text-anchor="middle" dominant-baseline="central" fill="' + svgPaint(it.fill) + '">' + escapeXml(it.text) + "</text>");
        break;
      case "image":
        // Only our own re-encoded PNG data URLs are ever embedded.
        if (SAFE_IMAGE_HREF_RE.test(it.href)) {
          out.push('<image href="' + it.href + '" x="' + f(it.x) + '" y="' + f(it.y) + '" width="' + f(it.w) + '" height="' + f(it.h) + '" preserveAspectRatio="none"/>');
        }
        break;
    }
  });
  out.push("</svg>");
  return out.join("");
}
