"use strict";

/* =========================================================================
 * Frame templates
 *
 * build(M, o, tx) returns:
 *   h         total height (width is always M.S)
 *   block     { x, y, size, radius? }  QR incl. quiet zone — drawn by the core, never by templates
 *   back      primitives drawn BEFORE the QR (anything overlapping the block gets covered)
 *   front     text primitives drawn AFTER the QR (dropped if they overlap the block)
 *   pageColor background of the whole image (null = transparent)
 *
 * To add a style: add an entry here and an <option> in #frameStyle (+ i18n key).
 *
 * Depends on: render/scene.js, core/util.js; t() from ui/i18n.js at render time
 * ========================================================================= */

// Classic layouts: optional frame line + text as plain lines or colored plates.
function classicTemplate(kind) {
  return {
    ownsText: false,
    build: function(M, o, tx) {
      const S = M.S;
      const framed = kind !== "none";
      const lw = kind === "dashed" ? Math.max(2, S * 0.008) : (framed ? Math.max(2, S * 0.015) : 0);
      const R = kind === "rounded" ? S * 0.06 : 0;
      const Rin = Math.max(0, R - lw);
      const inset = framed ? lw + S * 0.03 : 0;
      const B = S - inset * 2;
      const banner = o.textStyle === "banner";
      const innerW = S - lw * 2;
      const plainMaxW = S - 2 * Math.max(inset, S * 0.05);
      const back = [];
      const front = [];
      let y = lw;

      if (o.title) {
        if (banner) {
          const h = M.bandH(M.fontTitle);
          back.push({ type: "path", d: roundRectD(lw, y, innerW, h, [Rin, Rin, 0, 0]), fill: o.textBgColor });
          front.push.apply(front, tx({ text: o.title, cx: S / 2, cy: y + h / 2, basePx: M.fontTitle, maxWidth: innerW - S * 0.08, bold: true, bg: o.textBgColor, icon: o.wifiIcon && !o.caption }));
          y += h + (framed ? S * 0.03 : 0);
        } else {
          const h = M.fontTitle * 2.2;
          y += framed ? S * 0.02 : 0;
          front.push.apply(front, tx({ text: o.title, cx: S / 2, cy: y + h / 2, basePx: M.fontTitle, maxWidth: plainMaxW, bold: true, bg: o.qrBgColor, icon: o.wifiIcon && !o.caption }));
          y += h;
        }
      } else {
        y += framed ? inset - lw : 0;
      }

      const block = { x: inset, y: y, size: B };
      y += B;

      if (o.caption) {
        if (banner) {
          const h = M.bandH(M.fontCaption);
          y += framed ? S * 0.03 : 0;
          back.push({ type: "path", d: roundRectD(lw, y, innerW, h, [0, 0, Rin, Rin]), fill: o.textBgColor });
          front.push.apply(front, tx({ text: o.caption, cx: S / 2, cy: y + h / 2, basePx: M.fontCaption, maxWidth: innerW - S * 0.08, bold: true, bg: o.textBgColor, icon: o.wifiIcon }));
          y += h;
        } else {
          const h = M.fontCaption * 2.2;
          front.push.apply(front, tx({ text: o.caption, cx: S / 2, cy: y + h / 2, basePx: M.fontCaption, maxWidth: plainMaxW, bold: false, bg: o.qrBgColor, icon: o.wifiIcon }));
          y += h + (framed ? S * 0.02 : 0);
        }
      } else {
        y += framed ? inset - lw : 0;
      }
      y += lw;

      if (framed) {
        // The frame line goes last in the back layer so it sits on top of the plates.
        back.push({
          type: "path",
          d: roundRectD(lw / 2, lw / 2, S - lw, y - lw, R),
          stroke: o.frameColor,
          lineWidth: lw,
          dash: kind === "dashed" ? [lw * 4, lw * 3] : null
        });
      }
      return { h: y, block: block, back: back, front: front, pageColor: o.qrBgColor };
    }
  };
}

const FRAME_TEMPLATES = {
  none: classicTemplate("none"),
  border: classicTemplate("border"),
  rounded: classicTemplate("rounded"),
  dashed: classicTemplate("dashed"),

  // Thick colored card: title in the header band, caption in the footer band.
  card: {
    ownsText: true,
    build: function(M, o, tx) {
      const S = M.S;
      const edge = S * 0.06;
      const headH = o.title ? M.bandH(M.fontTitle) : edge;
      const footH = o.caption ? M.bandH(M.fontCaption) : edge;
      const B = S - edge * 2;
      const h = headH + B + footH;
      const back = [{ type: "path", d: roundRectD(0, 0, S, h, S * 0.06), fill: o.frameColor }];
      const front = [];
      if (o.title) {
        front.push.apply(front, tx({ text: o.title, cx: S / 2, cy: headH / 2, basePx: M.fontTitle, maxWidth: S - edge * 3, bold: true, bg: o.frameColor, icon: o.wifiIcon && !o.caption }));
      }
      if (o.caption) {
        front.push.apply(front, tx({ text: o.caption, cx: S / 2, cy: headH + B + footH / 2, basePx: M.fontCaption, maxWidth: S - edge * 3, bold: true, bg: o.frameColor, icon: o.wifiIcon }));
      }
      return { h: h, block: { x: edge, y: headH, size: B, radius: S * 0.03 }, back: back, front: front, pageColor: null };
    }
  },

  // Instant-photo look: narrow paper edges, a wide bottom strip holding title and caption,
  // and a soft offset shadow. The paper uses the frame colour; pick a light one for classic.
  polaroid: {
    ownsText: true,
    build: function(M, o, tx) {
      const S = M.S;
      const shadow = S * 0.012;
      const W = S - shadow;
      const edge = W * 0.06;
      const B = W - edge * 2;
      const lines = (o.title ? 1 : 0) + (o.caption ? 1 : 0);
      const titleH = o.title ? M.fontTitle * 1.9 : 0;
      const captionH = o.caption ? M.fontCaption * 1.9 : 0;
      const footH = Math.max(W * 0.18, titleH + captionH + (lines ? edge : 0));
      const h = edge + B + footH;
      const back = [
        { type: "path", d: roundRectD(shadow, shadow, W, h, S * 0.012), fill: shadeHex(o.frameColor, -0.35) },
        { type: "path", d: roundRectD(0, 0, W, h, S * 0.012), fill: o.frameColor }
      ];
      const front = [];
      let y = edge + B + (footH - titleH - captionH) / 2;
      if (o.title) {
        front.push.apply(front, tx({ text: o.title, cx: W / 2, cy: y + titleH / 2, basePx: M.fontTitle, maxWidth: W - edge * 3, bold: true, bg: o.frameColor, icon: o.wifiIcon && !o.caption }));
        y += titleH;
      }
      if (o.caption) {
        front.push.apply(front, tx({ text: o.caption, cx: W / 2, cy: y + captionH / 2, basePx: M.fontCaption, maxWidth: W - edge * 3, bold: false, bg: o.frameColor, icon: o.wifiIcon }));
      }
      return { h: h + shadow, block: { x: edge, y: edge, size: B }, back: back, front: front, pageColor: null };
    }
  },

  // Ribbon band with folded tails under the QR code.
  ribbon: {
    ownsText: true,
    build: function(M, o, tx) {
      const S = M.S;
      const margin = S * 0.1;           // block side margin, leaves room for the tails
      const B = S - margin * 2;
      const dark = shadeHex(o.frameColor, -0.3);
      const darker = shadeHex(o.frameColor, -0.55);
      const back = [];
      const front = [];
      let y = S * 0.03;

      if (o.title) {
        const th = M.fontTitle * 2.2;
        front.push.apply(front, tx({ text: o.title, cx: S / 2, cy: y + th / 2, basePx: M.fontTitle, maxWidth: S - margin * 2, bold: true, bg: o.qrBgColor }));
        y += th;
      }

      const block = { x: margin, y: y, size: B };
      y += B + S * 0.015;

      const h = M.bandH(M.fontCaption);
      const a = S * 0.07;               // main band inset from the edges
      const d = h * 0.3;                // tail tuck-in / fold width
      const drop = h * 0.3;             // tails sit lower than the band
      const notch = h * 0.35;           // V-cut depth at the tail ends
      const ty = y + drop;

      back.push({ type: "path", fill: dark,
        d: "M0 " + f(ty) + "H" + f(a + d) + "V" + f(ty + h) + "H0L" + f(notch) + " " + f(ty + h / 2) + "Z" });
      back.push({ type: "path", fill: dark,
        d: "M" + f(S) + " " + f(ty) + "H" + f(S - a - d) + "V" + f(ty + h) + "H" + f(S) + "L" + f(S - notch) + " " + f(ty + h / 2) + "Z" });
      back.push({ type: "path", fill: darker,
        d: "M" + f(a) + " " + f(y + h) + "H" + f(a + d) + "V" + f(y + h + drop) + "Z" });
      back.push({ type: "path", fill: darker,
        d: "M" + f(S - a) + " " + f(y + h) + "H" + f(S - a - d) + "V" + f(y + h + drop) + "Z" });
      back.push({ type: "rect", x: a, y: y, w: S - a * 2, h: h, fill: o.frameColor });

      front.push.apply(front, tx({ text: o.caption || t("scanMe"), cx: S / 2, cy: y + h / 2, basePx: M.fontCaption, maxWidth: S - a * 2 - S * 0.06, bold: true, bg: o.frameColor, icon: o.wifiIcon }));

      return { h: y + h + drop + S * 0.03, block: block, back: back, front: front, pageColor: o.qrBgColor };
    }
  },

  // Speech bubble above the QR code, pointing down at it.
  bubble: {
    ownsText: true,
    build: function(M, o, tx) {
      const S = M.S;
      const margin = S * 0.07;
      const B = S - margin * 2;
      const h = M.bandH(M.fontTitle);
      const bx = S * 0.1;
      const bw = S - bx * 2;
      const by = S * 0.03;
      const pw = h * 0.55;
      const ph = h * 0.38;
      const back = [
        { type: "path", d: roundRectD(bx, by, bw, h, h / 2), fill: o.frameColor },
        // The pointer starts 1px inside the pill to avoid an anti-aliasing seam.
        { type: "path", fill: o.frameColor,
          d: "M" + f(S / 2 - pw / 2) + " " + f(by + h - 1) + "H" + f(S / 2 + pw / 2) + "L" + f(S / 2) + " " + f(by + h + ph) + "Z" }
      ];
      const front = tx({ text: o.title || t("scanMe"), cx: S / 2, cy: by + h / 2, basePx: M.fontTitle, maxWidth: bw - h, bold: true, bg: o.frameColor, icon: o.wifiIcon });

      let y = by + h + ph + S * 0.01;
      const block = { x: margin, y: y, size: B };
      y += B;

      if (o.caption) {
        const ch = M.fontCaption * 2.2;
        front.push.apply(front, tx({ text: o.caption, cx: S / 2, cy: y + ch / 2, basePx: M.fontCaption, maxWidth: S - margin * 2, bold: false, bg: o.qrBgColor }));
        y += ch;
      } else {
        y += S * 0.03;
      }
      return { h: y, block: block, back: back, front: front, pageColor: o.qrBgColor };
    }
  }
};
