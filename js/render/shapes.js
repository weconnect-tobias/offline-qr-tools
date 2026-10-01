"use strict";

/* =========================================================================
 * QR shape registries (pure — no DOM, no jQuery)
 *
 * MODULE_SHAPES    the data modules ("dots"), neighbour-aware where useful
 * EYE_STYLES       the three finder patterns ("eyes"): a tested pair of
 *   EYE_FRAME_SHAPES (the 7×7 outer ring) and EYE_BALL_SHAPES (the 3×3 centre)
 *
 * Every entry returns SVG path data, so the canvas and SVG renderers draw identical
 * shapes. Names follow the conventions used by common QR designers (qr-code-styling,
 * QRCode Monkey). Scanners rely on the finder patterns, so eye shapes stay compact and
 * solid; every combination is decoded in tests/e2e/app.spec.js.
 *
 * Why eye styles are pairs instead of two free choices: a frame and centre with different
 * geometry (e.g. a square ring around a round centre) skews the module size the decoder
 * measures from the eyes, and in combination with dots or lines 30–90 % of the tested codes
 * stopped decoding. Pairs that failed were left out.
 *
 * To add a shape: add an entry with a `labelKey` (i18n key in every lang/*.js file) and
 * a pathD function (for eyes: an EYE_STYLES entry). The UI options, whitelists and scan
 * tests pick it up automatically — keep it only if the scan tests pass.
 *
 * Depends on: core/util.js (f, roundRectD)
 * ========================================================================= */

function circleD(cx, cy, r) {
  return "M" + f(cx - r) + " " + f(cy) + "a" + f(r) + " " + f(r) + " 0 1 0 " + f(2 * r) + " 0a" +
    f(r) + " " + f(r) + " 0 1 0 " + f(-2 * r) + " 0z";
}

function diamondD(cx, cy, r) {
  return "M" + f(cx) + " " + f(cy - r) + "L" + f(cx + r) + " " + f(cy) + "L" + f(cx) + " " + f(cy + r) +
    "L" + f(cx - r) + " " + f(cy) + "Z";
}

// Calls fn(row, col, x, y) for every dark data module (finder patterns are excluded by isDark).
function eachModule(isDark, n, x0, y0, cell, fn) {
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (isDark(row, col)) fn(row, col, x0 + col * cell, y0 + row * cell);
    }
  }
}

/* ---- Data modules ------------------------------------------------------- */
// pathD(isDark, n, x0, y0, cell): isDark(row, col) is false outside the code and inside the eyes.

const MODULE_SHAPES = {
  square: {
    labelKey: "shapeSquare",
    // Horizontal runs merged into one rectangle each: small output, no anti-aliasing seams.
    pathD: function(isDark, n, x0, y0, cell) {
      let d = "";
      for (let row = 0; row < n; row++) {
        let col = 0;
        while (col < n) {
          if (!isDark(row, col)) { col++; continue; }
          const start = col;
          while (col < n && isDark(row, col)) col++;
          const w = (col - start) * cell;
          d += "M" + f(x0 + start * cell) + " " + f(y0 + row * cell) + "h" + f(w) + "v" + f(cell) + "h" + f(-w) + "z";
        }
      }
      return d;
    }
  },
  rounded: {
    labelKey: "shapeRounded",
    pathD: function(isDark, n, x0, y0, cell) {
      let d = "";
      eachModule(isDark, n, x0, y0, cell, function(r, c, x, y) { d += roundRectD(x, y, cell, cell, cell * 0.28); });
      return d;
    }
  },
  dots: {
    labelKey: "shapeDots",
    // Full-width circles (neighbours touch): smaller dots made jsQR miss codes at some sizes.
    pathD: function(isDark, n, x0, y0, cell) {
      let d = "";
      eachModule(isDark, n, x0, y0, cell, function(r, c, x, y) { d += circleD(x + cell / 2, y + cell / 2, cell * 0.5); });
      return d;
    }
  },
  // Neighbouring modules flow together; only outer corners are rounded ("extra-rounded").
  fluid: {
    labelKey: "shapeFluid",
    pathD: function(isDark, n, x0, y0, cell) {
      const R = cell / 2;
      let d = "";
      eachModule(isDark, n, x0, y0, cell, function(r, c, x, y) {
        const up = isDark(r - 1, c), down = isDark(r + 1, c), left = isDark(r, c - 1), right = isDark(r, c + 1);
        d += roundRectD(x, y, cell, cell, [!up && !left ? R : 0, !up && !right ? R : 0, !down && !right ? R : 0, !down && !left ? R : 0]);
      });
      return d;
    }
  },
  // Leaf shape: rounded top-left and bottom-right where the module is free on that side.
  classy: {
    labelKey: "shapeClassy",
    pathD: function(isDark, n, x0, y0, cell) {
      const R = cell * 0.5;
      let d = "";
      eachModule(isDark, n, x0, y0, cell, function(r, c, x, y) {
        const up = isDark(r - 1, c), down = isDark(r + 1, c), left = isDark(r, c - 1), right = isDark(r, c + 1);
        d += roundRectD(x, y, cell, cell, [!up && !left ? R : 0, 0, !down && !right ? R : 0, 0]);
      });
      return d;
    }
  },
  diamond: {
    labelKey: "shapeDiamond",
    // Diamonds overlap their neighbours slightly: at a 0.56 radius a diamond covers only about
    // 60 % of its module and decoding failed at most sizes (measured by the scan tests).
    pathD: function(isDark, n, x0, y0, cell) {
      let d = "";
      eachModule(isDark, n, x0, y0, cell, function(r, c, x, y) { d += diamondD(x + cell / 2, y + cell / 2, cell * 0.68); });
      return d;
    }
  },
  vlines: {
    labelKey: "shapeVLines",
    // Vertical runs become one rounded bar each.
    pathD: function(isDark, n, x0, y0, cell) {
      const inset = cell * 0.05;
      let d = "";
      for (let col = 0; col < n; col++) {
        let row = 0;
        while (row < n) {
          if (!isDark(row, col)) { row++; continue; }
          const start = row;
          while (row < n && isDark(row, col)) row++;
          d += roundRectD(x0 + col * cell + inset, y0 + start * cell, cell - inset * 2, (row - start) * cell, (cell - inset * 2) / 2);
        }
      }
      return d;
    }
  },
  hlines: {
    labelKey: "shapeHLines",
    pathD: function(isDark, n, x0, y0, cell) {
      const inset = cell * 0.05;
      let d = "";
      for (let row = 0; row < n; row++) {
        let col = 0;
        while (col < n) {
          if (!isDark(row, col)) { col++; continue; }
          const start = col;
          while (col < n && isDark(row, col)) col++;
          d += roundRectD(x0 + start * cell, y0 + row * cell + inset, (col - start) * cell, cell - inset * 2, (cell - inset * 2) / 2);
        }
      }
      return d;
    }
  }
};

/* ---- Finder patterns ("eyes") ------------------------------------------ */
// Eye frame: outer 7×7 minus inner 5×5, rendered with the even-odd fill rule.
// pathD(x, y, cell) with (x, y) = top-left corner of the 7×7 pattern.

const EYE_FRAME_SHAPES = {
  square: function(x, y, c) { return roundRectD(x, y, 7 * c, 7 * c, 0) + roundRectD(x + c, y + c, 5 * c, 5 * c, 0); },
  rounded: function(x, y, c) { return roundRectD(x, y, 7 * c, 7 * c, 2.2 * c) + roundRectD(x + c, y + c, 5 * c, 5 * c, 1.3 * c); },
  circle: function(x, y, c) { return circleD(x + 3.5 * c, y + 3.5 * c, 3.5 * c) + circleD(x + 3.5 * c, y + 3.5 * c, 2.5 * c); },
  leaf: function(x, y, c) {
    return roundRectD(x, y, 7 * c, 7 * c, [3 * c, 0, 3 * c, 0]) + roundRectD(x + c, y + c, 5 * c, 5 * c, [2 * c, 0, 2 * c, 0]);
  }
};

// Eye ball: the 3×3 centre. pathD(x, y, cell) with (x, y) = top-left of the 3×3 area.
// The circle is slightly larger than 3 modules, which decoded more reliably than an exact one.
const EYE_BALL_SHAPES = {
  square: function(x, y, c) { return roundRectD(x, y, 3 * c, 3 * c, 0); },
  rounded: function(x, y, c) { return roundRectD(x, y, 3 * c, 3 * c, 0.9 * c); },
  circle: function(x, y, c) { return circleD(x + 1.5 * c, y + 1.5 * c, 1.65 * c); },
  leaf: function(x, y, c) { return roundRectD(x, y, 3 * c, 3 * c, [1.3 * c, 0, 1.3 * c, 0]); }
};

// The styles offered in the UI: frame + centre pairs that pass the scan tests.
const EYE_STYLES = {
  square: { labelKey: "eyeSquare", frame: "square", ball: "square" },
  rounded: { labelKey: "eyeRounded", frame: "rounded", ball: "rounded" },
  roundedDot: { labelKey: "eyeRoundedDot", frame: "rounded", ball: "circle" },
  circle: { labelKey: "eyeCircle", frame: "circle", ball: "circle" },
  leaf: { labelKey: "eyeLeaf", frame: "leaf", ball: "leaf" }
};

const GRADIENT_TYPES = ["none", "vertical", "horizontal", "diagonal", "radial"];

function isFinderModule(row, col, modCount) {
  return (row < 7 && col < 7) || (row < 7 && col >= modCount - 7) || (row >= modCount - 7 && col < 7);
}

// Top-left module of each finder pattern: top-left, top-right, bottom-left.
function finderOrigins(n) {
  return [[0, 0], [0, n - 7], [n - 7, 0]];
}

// Path data for the three eyes (frames + balls), to be filled with fillRule "evenodd".
function eyesPathD(n, x0, y0, cell, eyeStyle) {
  const style = Object.prototype.hasOwnProperty.call(EYE_STYLES, eyeStyle) ? EYE_STYLES[eyeStyle] : EYE_STYLES.square;
  const frame = EYE_FRAME_SHAPES[style.frame];
  const ball = EYE_BALL_SHAPES[style.ball];
  let d = "";
  finderOrigins(n).forEach(function(o) {
    const x = x0 + o[1] * cell, y = y0 + o[0] * cell;
    d += frame(x, y, cell) + ball(x + 2 * cell, y + 2 * cell, cell);
  });
  return d;
}

// Paint for the modules: a plain colour or a gradient spanning the whole code area.
function qrPaint(opts, x, y, size) {
  const type = GRADIENT_TYPES.indexOf(opts.gradient) > 0 ? opts.gradient : "none";
  if (type === "none") return opts.qrColor;
  const stops = [opts.qrColor, opts.gradientColor2];
  if (type === "radial") return { gradient: "radial", cx: x + size / 2, cy: y + size / 2, r: size * 0.72, stops: stops };
  const end = { vertical: [x, y + size], horizontal: [x + size, y], diagonal: [x + size, y + size] }[type];
  return { gradient: "linear", x1: x, y1: y, x2: end[0], y2: end[1], stops: stops };
}
