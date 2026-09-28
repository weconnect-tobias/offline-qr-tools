"use strict";

/* =========================================================================
 * Print layouts: A4/Letter sign, folding table tent, business-card sheet.
 *
 * A layout builds a PAGE MODEL in millimetres — a flat list of primitives:
 *   image { x, y, w, h, canvas, alias, rotate180 }
 *   text  { x, y (baseline), text, pt, font: "helvetica"|"courier", bold, color, rotate180 }
 *   rect  { x, y, w, h, stroke, lineWidth, radius, dash, fill }
 *   line  { x1, y1, x2, y2, stroke, lineWidth, dash }
 * pageToPdf() and pageToCanvas() render the same model, so the on-screen
 * preview always matches the downloaded PDF.
 *
 * Depends on: core/util.js (isWinAnsi, debounce), render/*, ui/state.js, ui/i18n.js,
 * ui/scan-check.js (lastScanStatus) and getRenderOpts() from app.js.
 * Everything runs locally; nothing is sent anywhere.
 *
 * SECURITY: the Wi-Fi password is NEVER rendered as readable text on any
 * printout. It exists only inside the QR code. A printed password can be read
 * or photographed by anyone passing by; the QR code at least requires a
 * deliberate scan. Do not add an option to print it.
 * ========================================================================= */

const PT_TO_MM = 25.4 / 72;
const PRINT_DPI = 300;
const PRINT_MIN_SCENE_PX = 600;
const PRINT_MAX_SCENE_PX = 2400;
const PREVIEW_PX_PER_MM = 2.4;

// Physical size of one QR module. Below ~0.4 mm most phone cameras struggle at
// normal distance; 0.6 mm gives a comfortable margin for home/office printers.
const MODULE_MM_FAIL = 0.4;
const MODULE_MM_WARN = 0.6;

const PAPER_SIZES = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 }
};

const PRINT_FONT_CSS = {
  helvetica: "Arial, Helvetica, sans-serif",  // Arial is metric-compatible with PDF Helvetica
  courier: "\"Courier New\", Courier, monospace"
};

const COLOR_TEXT = "#111111";
const COLOR_MUTED = "#374151";
const COLOR_GUIDE = "#9ca3af";

/* -------------------------------------------------------------------------
 * Text measurement and fitting (mm)
 * ------------------------------------------------------------------------- */

const _printMeasureCtx = document.createElement("canvas").getContext("2d");

function textWidthMm(text, pt, font, bold) {
  _printMeasureCtx.font = (bold ? "bold " : "") + "100px " + PRINT_FONT_CSS[font];
  // Measured at 100 px and scaled; +2 % head-room because PDF and canvas metrics differ slightly.
  return _printMeasureCtx.measureText(text).width / 100 * pt * PT_TO_MM * 1.02;
}

// Shrinks from maxPt down to minPt; if the text still does not fit it is truncated with "…".
// Only used for decorative text (headings, instructions) — never for credentials.
function fitLine(text, maxPt, minPt, maxWidthMm, font, bold) {
  let pt = maxPt;
  while (pt > minPt && textWidthMm(text, pt, font, bold) > maxWidthMm) pt -= 0.5;
  let out = text;
  while (out.length > 1 && textWidthMm(out, pt, font, bold) > maxWidthMm) out = out.slice(0, -2) + "…";
  return { text: out, pt: pt };
}

// Character-based wrapping for the network name: it must never be truncated,
// and SSIDs often contain no spaces to break on.
function wrapChars(text, pt, maxWidthMm, font, bold) {
  const lines = [];
  let line = "";
  for (const ch of Array.from(text)) {
    if (line && textWidthMm(line + ch, pt, font, bold) > maxWidthMm) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Picks the largest size (maxPt..minPt) at which the value fits in maxLines lines.
function fitWrapped(text, maxPt, minPt, maxWidthMm, maxLines, font, bold) {
  let pt = maxPt;
  let lines = wrapChars(text, pt, maxWidthMm, font, bold);
  while (lines.length > maxLines && pt > minPt) {
    pt -= 0.5;
    lines = wrapChars(text, pt, maxWidthMm, font, bold);
  }
  // Balance the lines (avoids a lone character on the last line), if the even split still fits.
  if (lines.length > 1) {
    const chars = Array.from(text);
    const per = Math.ceil(chars.length / lines.length);
    const balanced = [];
    for (let i = 0; i < chars.length; i += per) balanced.push(chars.slice(i, i + per).join(""));
    if (balanced.every(function(l) { return textWidthMm(l, pt, font, bold) <= maxWidthMm; })) lines = balanced;
  }
  return { lines: lines, pt: pt };
}

function lineHeightMm(pt) {
  return pt * PT_TO_MM * 1.25;
}

/* -------------------------------------------------------------------------
 * Content shared by all layouts
 * ------------------------------------------------------------------------- */

// Reads the current form state. Only the network name can be printed as text, and only
// when explicitly enabled. The password is deliberately never read here (see header).
function getPrintContent() {
  const opts = getRenderOpts();
  return {
    layout: ["sign", "tent", "cards"].indexOf($("#printLayout").val()) >= 0 ? $("#printLayout").val() : "sign",
    paper: PAPER_SIZES[$("#printPaper").val()] ? $("#printPaper").val() : "a4",
    heading: opts.title || t("printDefaultHeading"),
    instructions: $("#printInstructions").is(":checked"),
    ssid: $("#printShowSsid").is(":checked") ? $("#ssid").val().trim() : ""
  };
}

// The page renders its own heading, so the QR artwork is built without the title line.
function getPrintSceneOpts() {
  const opts = getRenderOpts();
  opts.title = "";
  return opts;
}

// Aspect ratio of the styled QR artwork (frames and captions change it).
function sceneAspect() {
  const s = buildScene(currentQR, 400, getPrintSceneOpts());
  return s.h / s.w;
}

// Largest artwork size that fits the box, keeping the aspect ratio.
function fitArtwork(boxW, boxH, aspect) {
  let w = boxW;
  let h = w * aspect;
  if (h > boxH) { h = boxH; w = h / aspect; }
  return { w: w, h: h };
}

// Renders the artwork at >= 300 dpi for the given physical width and reports its module size.
function renderArtwork(widthMm, rotate180) {
  const px = Math.max(PRINT_MIN_SCENE_PX, Math.min(PRINT_MAX_SCENE_PX, Math.ceil(widthMm / 25.4 * PRINT_DPI)));
  const scene = buildScene(currentQR, px, getPrintSceneOpts());
  let canvas = sceneToCanvas(scene);
  if (rotate180) canvas = rotateCanvas180(canvas);
  return { canvas: canvas, moduleMm: scene.cell / scene.w * widthMm };
}

function rotateCanvas180(src) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(src, 0, 0);
  return c;
}

// Builds text items for a vertical block of content inside a column.
// Returns { items, height } with y measured from the top of the block.
function buildTextBlock(content, colW, sizes, align) {
  const items = [];
  let y = 0;
  const xFor = function(widthMm) { return align === "center" ? (colW - widthMm) / 2 : 0; };

  if (sizes.headingPt) {
    const h = fitLine(content.heading, sizes.headingPt, sizes.headingPt * 0.5, colW, "helvetica", true);
    const lh = lineHeightMm(h.pt);
    y += lh * 0.8;
    items.push({ type: "text", x: xFor(textWidthMm(h.text, h.pt, "helvetica", true)), y: y, text: h.text, pt: h.pt, font: "helvetica", bold: true, color: COLOR_TEXT });
    y += lh * 0.45 + sizes.gapMm;
  }

  if (content.instructions && sizes.instructionPt) {
    const steps = sizes.shortInstructions ? [t("printScanShort")] : [t("printStep1"), t("printStep2"), t("printStep3")];
    steps.forEach(function(step) {
      const s = fitLine(step, sizes.instructionPt, sizes.instructionPt * 0.6, colW, "helvetica", false);
      y += lineHeightMm(s.pt);
      items.push({ type: "text", x: xFor(textWidthMm(s.text, s.pt, "helvetica", false)), y: y - lineHeightMm(s.pt) * 0.25, text: s.text, pt: s.pt, font: "helvetica", bold: false, color: COLOR_MUTED });
    });
    y += sizes.gapMm;
  }

  const creds = [];
  if (content.ssid) creds.push({ label: t("printSsidLabel"), value: content.ssid });
  if (creds.length) {
    const pad = sizes.credPt * PT_TO_MM * 0.9;
    const innerW = colW - pad * 2;
    const blockTop = y;
    let cy = y + pad;
    const credItems = [];
    creds.forEach(function(c) {
      // Label on its own line, value below in a monospaced font (tells 0/O and 1/l apart).
      const lab = fitLine(c.label, sizes.credPt * 0.8, sizes.credPt * 0.6, innerW, "helvetica", true);
      cy += lineHeightMm(lab.pt);
      credItems.push({ type: "text", x: pad, y: cy - lineHeightMm(lab.pt) * 0.25, text: lab.text, pt: lab.pt, font: "helvetica", bold: true, color: COLOR_MUTED });
      const val = fitWrapped(c.value, sizes.credPt, sizes.credPt * 0.6, innerW, 3, "courier", true);
      val.lines.forEach(function(line) {
        cy += lineHeightMm(val.pt);
        credItems.push({ type: "text", x: pad, y: cy - lineHeightMm(val.pt) * 0.25, text: line, pt: val.pt, font: "courier", bold: true, color: COLOR_TEXT });
      });
      cy += pad * 0.5;
    });
    cy += pad * 0.5;
    const boxH = cy - blockTop;
    items.push({ type: "rect", x: 0, y: blockTop, w: colW, h: boxH, stroke: "#767676", lineWidth: 0.3, radius: 2 });
    credItems.forEach(function(it) { items.push(it); });
    y = cy + sizes.gapMm;
  }

  return { items: items, height: Math.max(0, y - sizes.gapMm) };
}

function translateItems(items, dx, dy) {
  return items.map(function(it) {
    const c = Object.assign({}, it);
    if (c.type === "line") { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; }
    else { c.x += dx; c.y += dy; }
    return c;
  });
}

// Maps a panel-local item onto the page, optionally rotated 180° around the panel centre
// (the far side of a table tent must read correctly once folded).
function placeInPanel(it, panel, rotate) {
  const c = Object.assign({}, it);
  if (!rotate) return translateItems([c], panel.x, panel.y)[0];
  const mx = function(x) { return panel.x + panel.w - x; };
  const my = function(y) { return panel.y + panel.h - y; };
  if (c.type === "line") {
    c.x1 = mx(it.x1); c.x2 = mx(it.x2); c.y1 = my(it.y1); c.y2 = my(it.y2);
  } else if (c.type === "text") {
    c.x = mx(it.x); c.y = my(it.y); c.rotate180 = true;
  } else {
    c.x = mx(it.x + it.w); c.y = my(it.y + it.h);
    if (c.type === "image") c.rotate180 = true;
  }
  return c;
}

/* -------------------------------------------------------------------------
 * Layouts
 * ------------------------------------------------------------------------- */

// A4/Letter portrait sign: heading, large QR, instructions, optional credentials.
function layoutSign(content, paper) {
  const W = paper.w, H = paper.h, margin = 18;
  const colW = W - margin * 2;
  const aspect = sceneAspect();

  const head = buildTextBlock({ heading: content.heading }, colW, { headingPt: 40, gapMm: 8 }, "center");
  const tail = buildTextBlock({ instructions: content.instructions, ssid: content.ssid },
    Math.min(colW, 150), { instructionPt: 15, credPt: 16, gapMm: 8 }, "center");

  const maxArtH = H - margin * 2 - head.height - tail.height - 16;
  const art = fitArtwork(Math.min(colW, 150), maxArtH, aspect);
  const total = head.height + 8 + art.h + 8 + tail.height;
  let y = margin + Math.max(0, (H - margin * 2 - total) / 2);

  const items = translateItems(head.items, margin, y);
  y += head.height + 8;
  const rendered = renderArtwork(art.w, false);
  items.push({ type: "image", x: (W - art.w) / 2, y: y, w: art.w, h: art.h, canvas: rendered.canvas, alias: "qr" });
  y += art.h + 8;
  translateItems(tail.items, (W - Math.min(colW, 150)) / 2, y).forEach(function(it) { items.push(it); });

  return { w: W, h: H, items: items, moduleMm: rendered.moduleMm };
}

// Table tent: portrait sheet folded along the horizontal centre line into two landscape
// panels. The upper panel is rotated 180° so both sides read correctly when standing.
function layoutTent(content, paper) {
  const W = paper.w, H = paper.h;
  const panelH = H / 2, margin = 12, gap = 8;
  const aspect = sceneAspect();

  const artBoxW = (W - margin * 2) * 0.48;
  const art = fitArtwork(artBoxW, panelH - margin * 2, aspect);
  const colX = margin + art.w + gap;
  const colW = W - colX - margin;
  const block = buildTextBlock(content, colW, { headingPt: 26, instructionPt: 11, credPt: 12, gapMm: 5 }, "left");

  const upright = renderArtwork(art.w, false);
  const flipped = { canvas: rotateCanvas180(upright.canvas) };

  const panelItems = [{ type: "image", x: margin, y: (panelH - art.h) / 2, w: art.w, h: art.h, canvas: upright.canvas, alias: "qr" }];
  const textTop = Math.max(margin, (panelH - block.height) / 2);
  translateItems(block.items, colX, textTop).forEach(function(it) { panelItems.push(it); });

  const items = [];
  const lower = { x: 0, y: panelH, w: W, h: panelH };
  const upper = { x: 0, y: 0, w: W, h: panelH };
  panelItems.forEach(function(it) { items.push(placeInPanel(it, lower, false)); });
  panelItems.forEach(function(it) {
    const placed = placeInPanel(it, upper, true);
    if (placed.type === "image") { placed.canvas = flipped.canvas; placed.alias = "qr180"; placed.rotate180 = false; }
    items.push(placed);
  });

  // Fold guide (drawn outside the content area so it does not interfere with scanning).
  items.push({ type: "line", x1: 4, y1: panelH, x2: W - 4, y2: panelH, stroke: COLOR_GUIDE, lineWidth: 0.2, dash: [2, 2] });
  items.push({ type: "text", x: 5, y: panelH - 1.2, text: t("printFoldHere"), pt: 7, font: "helvetica", bold: false, color: COLOR_GUIDE });

  return { w: W, h: H, items: items, moduleMm: upright.moduleMm };
}

// Business-card sheet: 85 × 55 mm cards in a centred grid with crop marks.
function layoutCards(content, paper) {
  const W = paper.w, H = paper.h;
  const cardW = 85, cardH = 55, pad = 4, cols = 2;
  // Keep >= 10 mm top/bottom: most desktop printers cannot print closer to the edge.
  const rows = Math.floor((H - 20) / cardH);
  const gridW = cols * cardW, gridH = rows * cardH;
  const x0 = (W - gridW) / 2, y0 = (H - gridH) / 2;
  const aspect = sceneAspect();

  const art = fitArtwork(38, cardH - pad * 2, aspect);
  const colX = pad + art.w + 3;
  const colW = cardW - colX - pad;
  const block = buildTextBlock(content, colW,
    { headingPt: 12, instructionPt: 7, credPt: 8, gapMm: 2, shortInstructions: true }, "left");
  const rendered = renderArtwork(art.w, false);

  const card = [{ type: "image", x: pad, y: (cardH - art.h) / 2, w: art.w, h: art.h, canvas: rendered.canvas, alias: "qr" }];
  translateItems(block.items, colX, Math.max(pad, (cardH - block.height) / 2)).forEach(function(it) { card.push(it); });

  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = x0 + c * cardW, cy = y0 + r * cardH;
      // Very light outline as a cutting aid; crop marks below are the precise reference.
      items.push({ type: "rect", x: cx, y: cy, w: cardW, h: cardH, stroke: "#e5e7eb", lineWidth: 0.1 });
      translateItems(card, cx, cy).forEach(function(it) { items.push(it); });
    }
  }

  const mark = 5, off = 2;
  for (let c = 0; c <= cols; c++) {
    const x = x0 + c * cardW;
    items.push({ type: "line", x1: x, y1: y0 - off - mark, x2: x, y2: y0 - off, stroke: "#000000", lineWidth: 0.2 });
    items.push({ type: "line", x1: x, y1: y0 + gridH + off, x2: x, y2: y0 + gridH + off + mark, stroke: "#000000", lineWidth: 0.2 });
  }
  for (let r = 0; r <= rows; r++) {
    const y = y0 + r * cardH;
    items.push({ type: "line", x1: x0 - off - mark, y1: y, x2: x0 - off, y2: y, stroke: "#000000", lineWidth: 0.2 });
    items.push({ type: "line", x1: x0 + gridW + off, y1: y, x2: x0 + gridW + off + mark, y2: y, stroke: "#000000", lineWidth: 0.2 });
  }

  return { w: W, h: H, items: items, moduleMm: rendered.moduleMm, cardCount: rows * cols };
}

const PRINT_LAYOUTS = { sign: layoutSign, tent: layoutTent, cards: layoutCards };

function buildPrintPage() {
  const content = getPrintContent();
  const page = PRINT_LAYOUTS[content.layout](content, PAPER_SIZES[content.paper]);
  page.layout = content.layout;
  page.paper = content.paper;
  return page;
}

/* -------------------------------------------------------------------------
 * Renderers
 * ------------------------------------------------------------------------- */

function textToCanvas(it, pxPerMm) {
  const fontPx = it.pt * PT_TO_MM * pxPerMm;
  const font = (it.bold ? "bold " : "") + fontPx + "px " + PRINT_FONT_CSS[it.font];
  _printMeasureCtx.font = font;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(_printMeasureCtx.measureText(it.text).width + 2));
  c.height = Math.ceil(fontPx * 1.4);
  const ctx = c.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = it.color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(it.text, 1, fontPx * 1.05);
  return { canvas: c, baselineOffsetMm: fontPx * 1.05 / pxPerMm };
}

function pageToPdf(page) {
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: page.paper, orientation: "portrait" });
  const imageCache = new Map();

  page.items.forEach(function(it) {
    switch (it.type) {
      case "image": {
        // The same artwork is repeated on card sheets: embed it once via its alias.
        let dataUrl = imageCache.get(it.alias);
        if (!dataUrl) { dataUrl = it.canvas.toDataURL("image/png"); imageCache.set(it.alias, dataUrl); }
        doc.addImage(dataUrl, "PNG", it.x, it.y, it.w, it.h, it.alias, "SLOW");
        break;
      }
      case "text": {
        if (isWinAnsi(it.text)) {
          doc.setFont(it.font, it.bold ? "bold" : "normal");
          doc.setFontSize(it.pt);
          doc.setTextColor(it.color);
          if (it.rotate180) doc.text(it.text, it.x, it.y, { angle: 180 });
          else doc.text(it.text, it.x, it.y);
        } else {
          const r = textToCanvas(it, 24);
          const w = r.canvas.width / 24, h = r.canvas.height / 24;
          const canvas = it.rotate180 ? rotateCanvas180(r.canvas) : r.canvas;
          const x = it.rotate180 ? it.x - w : it.x;
          const y = it.rotate180 ? it.y - (h - r.baselineOffsetMm) : it.y - r.baselineOffsetMm;
          doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, w, h, undefined, "SLOW");
        }
        break;
      }
      case "rect":
        doc.setLineWidth(it.lineWidth || 0.2);
        doc.setDrawColor(it.stroke || "#000000");
        doc.setLineDashPattern(it.dash || [], 0);
        if (it.radius) doc.roundedRect(it.x, it.y, it.w, it.h, it.radius, it.radius, "S");
        else doc.rect(it.x, it.y, it.w, it.h, "S");
        doc.setLineDashPattern([], 0);
        break;
      case "line":
        doc.setLineWidth(it.lineWidth || 0.2);
        doc.setDrawColor(it.stroke || "#000000");
        doc.setLineDashPattern(it.dash || [], 0);
        doc.line(it.x1, it.y1, it.x2, it.y2);
        doc.setLineDashPattern([], 0);
        break;
    }
  });
  return doc;
}

function pageToCanvas(page, pxPerMm) {
  const c = document.createElement("canvas");
  c.width = Math.round(page.w * pxPerMm);
  c.height = Math.round(page.h * pxPerMm);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(pxPerMm, pxPerMm);

  page.items.forEach(function(it) {
    switch (it.type) {
      case "image":
        ctx.drawImage(it.canvas, it.x, it.y, it.w, it.h);
        break;
      case "text":
        ctx.save();
        ctx.fillStyle = it.color;
        ctx.font = (it.bold ? "bold " : "") + (it.pt * PT_TO_MM) + "px " + PRINT_FONT_CSS[it.font];
        ctx.textBaseline = "alphabetic";
        ctx.translate(it.x, it.y);
        if (it.rotate180) ctx.rotate(Math.PI);
        ctx.fillText(it.text, 0, 0);
        ctx.restore();
        break;
      case "rect":
        ctx.save();
        ctx.strokeStyle = it.stroke || "#000000";
        ctx.lineWidth = it.lineWidth || 0.2;
        ctx.setLineDash(it.dash || []);
        ctx.beginPath();
        if (it.radius && ctx.roundRect) ctx.roundRect(it.x, it.y, it.w, it.h, it.radius);
        else ctx.rect(it.x, it.y, it.w, it.h);
        ctx.stroke();
        ctx.restore();
        break;
      case "line":
        ctx.save();
        ctx.strokeStyle = it.stroke || "#000000";
        ctx.lineWidth = it.lineWidth || 0.2;
        ctx.setLineDash(it.dash || []);
        ctx.beginPath();
        ctx.moveTo(it.x1, it.y1);
        ctx.lineTo(it.x2, it.y2);
        ctx.stroke();
        ctx.restore();
        break;
    }
  });
  return c;
}

/* -------------------------------------------------------------------------
 * UI
 * ------------------------------------------------------------------------- */

const PRINT_STATUS_ICONS = { ok: "✓", warn: "!", fail: "✕" };
let lastPrintStatus = null;

function formatMm(value) {
  return value.toLocaleString(currentLang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setPrintStatus(moduleMm) {
  const el = $("#printStatus");
  if (moduleMm === null) {
    lastPrintStatus = null;
    el.attr("hidden", true).removeAttr("data-state");
    return;
  }
  let state = "ok", key = "printSizeOk";
  if (moduleMm < MODULE_MM_FAIL) { state = "fail"; key = "printSizeFail"; }
  else if (moduleMm < MODULE_MM_WARN) { state = "warn"; key = "printSizeWarn"; }
  lastPrintStatus = state;
  el.removeAttr("hidden").attr("data-state", state);
  el.find(".scan-icon").text(PRINT_STATUS_ICONS[state]);
  // Text is built from a translated template; only a number is inserted, via .text().
  el.find(".scan-text").text(t(key).replace("{mm}", formatMm(moduleMm)));
}

function renderPrintPreview() {
  // Rendering a full page is comparatively expensive; skip it while the section is closed.
  if (!$("#printSection").prop("open")) return;
  if (!currentQR) {
    $("#printPreview").empty();
    setPrintStatus(null);
    $("#printDownload").prop("disabled", true);
    return;
  }
  const page = buildPrintPage();
  const canvas = pageToCanvas(page, PREVIEW_PX_PER_MM);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("printPreviewAlt"));
  $("#printPreview").empty().append(canvas);
  setPrintStatus(isDemo ? null : page.moduleMm);
  $("#printDownload").prop("disabled", isDemo);
}

const renderPrintPreviewDebounced = debounce(renderPrintPreview, 200);

function downloadPrintPdf() {
  if (!currentQR || isDemo) return;
  if (!window.jspdf) { alert(t("pdfLibError")); return; }
  if ((lastScanStatus === "fail" || lastPrintStatus === "fail") && !window.confirm(t("printFailConfirm"))) return;
  const page = buildPrintPage();
  pageToPdf(page).save("wifi-qr-" + page.layout + ".pdf");
}

$("#printSection").on("toggle", renderPrintPreview);
$("#printLayout, #printPaper, #printInstructions, #printShowSsid").on("change", renderPrintPreview);
$(document).on("preview:rendered i18n:applied", renderPrintPreviewDebounced);
$("#printDownload").on("click", downloadPrintPdf);
