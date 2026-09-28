# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini, …) and human
contributors working on this repository. Read this file completely before changing code.

## What this is

A bilingual (Swedish/English) **Wi-Fi QR code generator** that runs entirely in the browser.
The user enters a network name (SSID) and password; the app produces a QR code that phones scan
to join the network, with optional styling (colors, dot shape, logo, frames, ribbons), a local
"can it be scanned?" self-test, and exports (PNG, SVG, PDF, print layouts).

It is a static site: open `index.html` directly from disk or serve the folder from any web server.
There is **no build step, no backend, no package manager at runtime**.

## Non-negotiable rules

These are security and privacy guarantees made to users. A change that breaks one is a bug,
even if a user or an issue asks for it. If a request conflicts with a rule, stop and explain.

1. **No network requests. Ever.** Wi-Fi credentials must never leave the browser.
   - Enforced by the Content-Security-Policy `<meta>` in `index.html`
     (`default-src 'none'; script-src 'self'; connect-src 'none'; …`). Do not loosen it.
   - No CDNs, web fonts, analytics, telemetry, error reporting, update checks or "phone home".
   - Third-party code is vendored in `vendor/` (see "Dependencies").
2. **The Wi-Fi password is never rendered as readable text** in any output: not on print
   layouts, not in captions, not in file names, PDF metadata, logs or console output.
   It exists only inside the QR code. A printed password can be read or photographed by anyone
   passing by. Do not add an option to print it. (`checkPasswordInText()` warns if a user types
   it into the heading/caption themselves.) The network name may be printed, opt-in only.
3. **No inline scripts, inline styles or `style=""` attributes** in HTML — the CSP blocks them.
   Put CSS in `css/app.css`, JS in `js/`. Setting styles from JS via jQuery/CSSOM is fine.
4. **Treat all input as hostile.**
   - Text into the DOM: `.text()` / `textContent` only. Never `.html()` / `innerHTML` with data.
   - Colors: always through `sanitizeHex()` before use (they end up in SVG attributes).
   - Text in SVG: always through `escapeXml()`.
   - Wi-Fi payload fields: always through `escapeWifi()`.
   - Logos: only via the hardened pipeline in `js/app.js` (size cap → magic-byte check PNG/JPEG
     → dimension cap → re-encode to a clean PNG). SVG uploads are not allowed.
5. **Every user-facing string exists in every language file** (`lang/sv.js`, `lang/en.js`), same keys.
6. **WCAG 2.1 AA.** Text contrast ≥ 4.5:1, component borders ≥ 3:1, every control has an
   accessible name, keyboard operable, dynamic messages use `role="status"`/`role="alert"`.
7. **Code, comments, docs and identifiers in English.** UI text lives in the language files.

## File map

```
index.html                  Markup only (+ CSP). Loads the scripts in the order below.
css/app.css                 All styles. Accessibility notes at the bottom.
lang/sv.js, lang/en.js      I18N.<code> = { key: "text", … , langName, flagCode }
js/core/util.js             PURE: escaping, sanitizing, colour maths, isWinAnsi
js/core/payload.js          PURE: buildWifiPayload(), validatePassword()
js/render/scene.js          Scene primitives, text fitting (needs a canvas)
js/render/templates.js      FRAME_TEMPLATES (none, border, rounded, dashed, card, ribbon, bubble)
js/render/renderer.js       buildScene(), sceneToCanvas(), sceneToSVG()
js/ui/state.js              Shared mutable UI state (currentQR, currentPayload, …)
js/ui/i18n.js               t(), applyI18n(), language picker
js/ui/color-picker.js       Accessible colour picker
js/ui/scan-check.js         Scan self-test (jsQR)
js/ui/logo.js               Hardened logo upload
js/app.js                   Controller: form → payload → preview → downloads (loaded last but one)
js/print-layouts.js         Print PDFs: sign, table tent, card sheet
assets/flags/<code>.svg     Local flag icons for the language picker (un.svg = fallback)
vendor/                     Vendored libraries + licenses + manifest.json + README.md
tools/Check-Dependencies.ps1  Checks/updates vendored libraries (developer tool, not the app)
tests/unit/                 node:test — pure modules, i18n, static security rules, vendor checksums
tests/e2e/                  Playwright — the app in a real browser, with network/CSP guards
tests/support/              Test helpers (VM script loader, static server)
```

Script load order (classic scripts sharing globals — ES modules are blocked on `file://`,
and the app must work when `index.html` is double-clicked):
`vendor/*` → `lang/*.js` → `js/core/*` → `js/render/*` → `js/ui/state.js` → `js/ui/i18n.js` →
`js/ui/color-picker.js` → `js/ui/scan-check.js` → `js/ui/logo.js` → `js/app.js` → `js/print-layouts.js`.
Keep `js/core/*` free of DOM/jQuery so it stays unit-testable in Node.

## Architecture

### Payload (`js/core/payload.js`: `buildWifiPayload`, `validatePassword`; `escapeWifi` in `js/core/util.js`)
Format: `WIFI:T:<WPA|WEP|nopass|WPA2-EAP>;S:<ssid>;P:<password>;H:<true|false>;;` with `\ ; , : "`
escaped. Never prepend anything before `WIFI:` (Android requires it first). Encoding is UTF-8
(`qrcode.stringToBytes` is switched to the library's UTF-8 encoder at startup). Error correction
level is always `H` (allows logos). Validation: SSID ≤ 32 bytes; WPA 8–63 chars or 64 hex;
WEP 5/13 chars or 10/26 hex. Security type, EAP method and phase 2 are whitelisted because they
are inserted unescaped. `buildPayload()` in `js/app.js` only reads the form and calls it.

### Scene model and renderers (`js/render/*`)
`buildScene(qr, sizePx, opts)` returns `{ w, h, items, cell, lowTextContrast }` where `items` is a
flat list of primitives: `rect`, `path` (SVG path syntax), `circle`, `text`, `image`.
`sceneToCanvas()` (PNG, PDF, preview) and `sceneToSVG()` render the same list, so every style is
written once. The QR block (modules + 4-module quiet zone) is drawn by the core, never by a
template, and text overlapping it is dropped — templates cannot break scannability.

### Frame templates (`FRAME_TEMPLATES` in `js/render/templates.js`)
`none`, `border`, `rounded`, `dashed`, `card`, `ribbon`, `bubble`. Each has
`build(M, o, tx)` → `{ h, block, back, front, pageColor }`. `ownsText: true` means the template
decides where text goes.

### Scan self-test (`js/ui/scan-check.js`: `verifyScan`, `scheduleScanCheck`)
After each change the preview is decoded locally with jsQR and compared **byte-for-byte** with
the payload: normal read at ~6 px/module (must pass), inverted read (warn), downscaled to
~3 px/module (warn). Status in `#scanStatus`. Download asks for confirmation when it fails.

### Print layouts (`js/print-layouts.js`)
A layout builds a page model in millimetres (`image`, `text`, `rect`, `line`) rendered by both
`pageToPdf()` (jsPDF) and `pageToCanvas()` (preview). QR artwork is embedded at ≥ 300 dpi.
Physical module size is checked (warn < 0.6 mm, fail < 0.4 mm). Text outside Windows-1252
(PDF standard fonts) is drawn as an image instead of producing wrong glyphs.

### Events between modules
- `preview:rendered` — fired by `renderPreview()` after every redraw.
- `i18n:applied` — fired by `applyI18n()` after a language switch.

## How to …

**Add a language:** copy `lang/en.js` to `lang/<code>.js`, translate every value, set
`langName` (in that language) and `flagCode`, add `assets/flags/<flagCode>.svg`, add a
`<script src="lang/<code>.js">` line in `index.html`. Nothing else.

**Add a frame style:** add an entry to `FRAME_TEMPLATES`, an `<option>` in `#frameStyle` and the
label key in every language file. Use only scene primitives; never draw over the QR block.

**Add a print layout:** add a function to `PRINT_LAYOUTS` in `js/print-layouts.js` returning
`{ w, h, items, moduleMm }`, plus an `<option>` in `#printLayout` and i18n keys.

**Add a UI string:** add the key to **every** file in `lang/`, reference it with `data-i18n="key"`
(text), `data-i18n-placeholder="key"` or `t("key")` in JS.

## Dependencies

The app has **no runtime package manager**: `package.json` only defines development test tooling.
All third-party code is vendored in `vendor/` and listed in `vendor/manifest.json` (source of
truth: version, file, SHA-384). Never hand-edit a vendored file, never load a library from a CDN.

```powershell
.\tools\Check-Dependencies.ps1                 # checksums, updates, known advisories
.\tools\Check-Dependencies.ps1 -Update -WhatIf # preview updates
.\tools\Check-Dependencies.ps1 -Update         # update within major versions (verified + rollback)
```
Details in `vendor/README.md`. Current: jQuery 4, qrcode-generator 2, jsQR 1.4, jsPDF 4.
Before adding a new dependency: check it is maintained, has no open advisories, works without
network access, and ask the maintainer first — the dependency count is kept deliberately small.

## Tests

```sh
npm install                          # dev tooling only (Playwright, axe-core); the app has no runtime deps
npx playwright install chromium      # once
npm test                             # unit + browser tests (~1 min)
npm run test:unit                    # fast, no browser
```

- `tests/unit/` (Node's built-in `node:test`): payload format and escaping, password/SSID rules,
  sanitizing, i18n key parity, **static security rules** (CSP, no inline code, no remote URLs,
  no `innerHTML`/`eval`/`fetch`, print code never reads the password) and vendor checksums.
- `tests/e2e/` (Playwright): every test runs inside guards that **fail it on any external network
  request, CSP violation or console error**. Covers the scan self-test, exact decoding of the PNG
  export, every frame × dot shape, password never in SVG/PDF output, logo upload hardening,
  language switch, all print layouts (every QR on the page decoded), `file://` usage and
  WCAG 2.1 A/AA via axe-core.
- CI (`.github/workflows/ci.yml`) runs the tests plus `tools/Check-Dependencies.ps1` on every
  push/PR and weekly.

Rules for changes:
1. `npm test` must pass. Add or update tests for every behaviour change; a new rule in this file
   should get a static test in `tests/unit/security-static.test.js` when it can be checked.
2. Never weaken a guard or a security test to make a change pass — fix the change.
3. Still scan real printouts/exports with an iPhone and an Android phone before a release;
   the tests decode with jsQR, not with phone cameras.
4. Dependencies touched: run `tools/Check-Dependencies.ps1` (exit code 0 or 1).

## Conventions

- 2-space indentation, double quotes in JS, `"use strict"`, `function` declarations for top-level
  helpers, short comments explaining **why**, not what.
- Line endings are defined in `.gitattributes`; charset UTF-8 without BOM.
- `tools/*.ps1` must stay **ASCII-only** (Windows PowerShell 5.1 misreads UTF-8 without BOM) and
  compatible with PowerShell 5.1 (no `??`, ternary or `-AsHashtable`).
- Keep functions small and single-purpose; prefer extending the scene/page models over adding
  special cases to the renderers.

## Known quirks (do not "fix" these back)

- jsQR 1.4.0: `inversionAttempts: "onlyInvert"` never builds the inverted image — use
  `"invertFirst"`; it can also throw on images without finder patterns — treat as "not decoded".
- jsPDF 4: `addImage` without a compression argument embeds bitmaps uncompressed (~7 MB);
  always pass `"SLOW"`.
- jsPDF standard fonts only cover Windows-1252; `isWinAnsi()` routes other text to images.
- OpenCV's QR decoder cannot decode emoji in UTF-8 payloads; verify with jsQR instead.
- Files written by some AI tools get a C2PA `<metadata>` block (e.g. in SVGs). It is harmless
  but should be stripped from committed assets.
