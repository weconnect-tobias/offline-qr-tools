# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini, …) and human
contributors working on this repository. Read this file completely before changing code.

## What this is

Repository: https://github.com/weconnect-tobias/offline-qr-tools (MIT).

A bilingual (Swedish/English) **QR code generator that runs entirely in the browser**. Content
types: Wi-Fi, web address (URL), text, e-mail, phone, SMS, contact card (vCard 3.0), location
(geo), calendar event (iCalendar) and Swish payment. Every type shares the same styling (colors,
gradients, dot and corner shapes, logo, frames, ribbons), the local "can it be scanned?" self-test, and the exports (PNG, SVG, PDF, print layouts).

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
   - Wi-Fi payload fields: always through `escapeWifi()`; vCard values through `escapeVcard()`;
     mailto: parameters through `encodeURIComponent()`.
   - URLs (URL type and vCard website): only `http:`/`https:` via `parseWebUrl()`. Never allow
     `javascript:`, `data:`, `file:` etc., and reject `user:password@host` (phishing disguise).
   - The type in the address (`index.html#url`) is whitelisted against `QR_TYPE_IDS`.
   - Logos (uploaded or from a design file): only via `decodeLogoBuffer()` in `js/ui/logo.js` (size cap → magic-byte check PNG/JPEG
     → dimension cap → re-encode to a clean PNG). SVG uploads are not allowed.
5. **Every user-facing string exists in every language file** (`lang/sv.js`, `lang/en.js`), same keys.
6. **WCAG 2.1 AA.** Text contrast ≥ 4.5:1, component borders ≥ 3:1, every control has an
   accessible name, keyboard operable, dynamic messages use `role="status"`/`role="alert"` —
   in **both the light and the dark theme** (axe runs in both).
7. **Code, comments, docs and identifiers in English.** UI text lives in the language files.

## File map

```
index.html                  Markup only (+ CSP). Loads the scripts in the order below.
css/app.css                 All styles. Theme colours as CSS variables at the top (light, dark, print).
lang/sv.js, lang/en.js      I18N.<code> = { key: "text", … , langName, flagCode }
js/core/util.js             PURE: escaping, sanitizing, colour maths, isWinAnsi
js/core/payload.js          PURE: buildWifiPayload(), validatePassword()
js/core/qr-types.js         PURE: QR_TYPES registry, buildQrPayload(type, input) for every content type
js/core/password.js         PURE: generateWifiPassword(randomBytes) — the UI passes crypto.getRandomValues
js/core/design.js           PURE: design files — DESIGN_FIELDS, buildDesign(), parseDesignFile()
js/render/scene.js          Scene primitives, text fitting (needs a canvas)
js/render/shapes.js         PURE: MODULE_SHAPES, EYE_STYLES, GRADIENT_TYPES, qrPaint()
js/render/templates.js      FRAME_TEMPLATES (none, border, rounded, dashed, double, brackets, card, polaroid, stamp, ribbon, bubble)
js/render/renderer.js       buildScene(), sceneToCanvas(), sceneToSVG()
js/ui/state.js              Shared mutable UI state (currentQR, currentPayload, …)
js/ui/i18n.js               t(), applyI18n(), language picker
js/ui/color-picker.js       Accessible colour picker
js/ui/scan-check.js         Scan self-test (jsQR)
js/ui/logo.js               Hardened logo upload (decodeLogoBuffer, also used for design files; loadBundledLogo); a load counter makes the newest load or removal win
js/assets/swish-symbols.js  GENERATED: the Swish symbol (colour + grayscale) as data URLs — Getswish AB trademark
js/ui/design-file.js        Save / open design files (loaded last)
js/app.js                   Controller: form → payload → preview → downloads (loaded last but one)
js/print-layouts.js         Print PDFs: sign, table tent, card sheet
assets/flags/<code>.svg     Local flag icons for the language picker (un.svg = fallback)
assets/swish/               Swish symbol SVGs + NOTICE.md (third-party trademark, not MIT)
vendor/                     Vendored libraries + licenses + manifest.json + README.md
tools/Check-Dependencies.ps1  Checks/updates vendored libraries (developer tool, not the app)
tools/build-site.sh         Copies the runtime files to dist/site (Pages) and, with --zip, the release zip
tests/unit/                 node:test — pure modules, i18n, static security rules, vendor checksums
tests/e2e/                  Playwright — the app in a real browser, with network/CSP guards
tests/support/              Test helpers (VM script loader, static server)
docs/device-testing.md      Manual checklist for real phones and printouts (before every release)
SECURITY.md, CHANGELOG.md   Vulnerability reporting; changes (add yours under "Unreleased")
```

Script load order (classic scripts sharing globals — ES modules are blocked on `file://`,
and the app must work when `index.html` is double-clicked):
`vendor/*` → `lang/*.js` → `js/core/*` → `js/render/scene.js` → `js/render/shapes.js` →
`js/render/templates.js` → `js/render/renderer.js` → `js/ui/state.js` → `js/ui/i18n.js` →
`js/ui/color-picker.js` → `js/ui/scan-check.js` → `js/ui/logo.js` → `js/assets/swish-symbols.js` → `js/app.js` → `js/print-layouts.js` →
`js/ui/design-file.js`.
Keep `js/core/*` free of DOM/jQuery so it stays unit-testable in Node.

## Architecture

### Content types (`js/core/qr-types.js`)
`buildQrPayload(type, input)` returns `{ payload, summary, warning? }` or `{ error, visible? }`
(`error` is an i18n key; `visible: false` means "not filled in yet", shown silently as the demo).
`summary` is a short, **non-secret** description used for captions and print layouts (for Wi-Fi it
is the SSID). Formats: URL → normalised `href`; text → verbatim; e-mail → `mailto:` with encoded
subject/body; phone → `tel:`; SMS → `SMSTO:<number>:<message>`; contact → vCard 3.0 with CRLF;
location → `geo:lat,lon` (written as typed, never `1e-7`); event → `VCALENDAR`/`VEVENT` with CRLF, `PRODID`, a `UID` and `DTSTAMP`
(both derived from the event, so the same event always gives the same code), times as floating local time
(no `Z`/`TZID`, so 14:00 shows as 14:00 on every phone), all-day events as `VALUE=DATE` with an
exclusive end, one hour by default, text escaped like vCard so nothing can start a new property;
Swish → `https://app.swish.nu/1/p/sw/?sw=…[&amt=…&cur=SEK]&msg=…[&edit=amt,msg]&src=qr`,
**byte-for-byte the link Swish's own generator (swish.nu/marknadsmaterial/qr-generator) encodes**
— verified by decoding its codes; keep it that way. `msg` is always present (`msg=` when empty;
locked empty message = the payer cannot write one); an empty amount is left out together with
`cur`, is always open and can't be locked; amounts are written like JS numbers (`49.5`). The
phone camera opens the link in the Swish app (the older `C…;…` text only works in the app's own
scanner). Payee: mobile 07…, company 123… or 90 account, never editable; amount 1–999 999.99;
message ≤ 50 characters, URL-encoded. `SWISH_LOOKS` in `js/app.js` applies Swish's guidelines for own codes: rounded eyes, the Swish
symbol without wordmark at 25 % with the empty area behind it, caption "Pay with Swish" (the
symbol may only appear without its wordmark next to the word Swish). Looks: `standard` (black
code, colour symbol — Swish's own generator), `bw` (grayscale symbol, as Swish renders black and
white) and `gradient` (45° purple→red). The symbol is bundled in `assets/swish/` and embedded as
data URLs in `js/assets/swish-symbols.js` (generated, checked by a unit test; data URLs because
file:// images would taint the canvas). It is a **Getswish AB trademark, not MIT** — see
`assets/swish/NOTICE.md`; use it only for Swish payment codes. It is loaded through
`loadBundledLogo()`, which accepts only those bundled data URLs; user SVG uploads stay blocked. Payloads are capped at 1000 UTF-8 bytes so codes stay scannable with a
logo. The UI reads the active panel via `TYPE_READERS` in `js/app.js`; the selected type is kept
in `currentType` and mirrored in the address (`index.html#vcard`).

### Wi-Fi payload (`js/core/payload.js`: `buildWifiPayload`, `validatePassword`; `escapeWifi` in `js/core/util.js`)
Format: `WIFI:T:<WPA|WEP|nopass|WPA2-EAP>;S:<ssid>;P:<password>;H:<true|false>;;` with `\ ; , : "`
escaped. Never prepend anything before `WIFI:` (Android requires it first). Encoding is UTF-8
(`qrcode.stringToBytes` is switched to the library's UTF-8 encoder at startup). Error correction
comes from `errorCorrectionLevel()` in `js/app.js`: always `H` with a logo, otherwise the user's
choice (`auto` = `Q`). Validation: SSID ≤ 32 bytes; WPA 8–63 chars or 64 hex;
WEP 5/13 chars or 10/26 hex. Security type, EAP method and phase 2 are whitelisted because they
are inserted unescaped. `buildPayload()` in `js/app.js` only reads the form and calls it.

### Scene model and renderers (`js/render/*`)
`buildScene(qr, sizePx, opts)` returns `{ w, h, items, cell, lowTextContrast }` where `items` is a
flat list of primitives: `rect`, `path` (SVG path syntax), `circle`, `text`, `image`.
`sceneToCanvas()` (PNG, PDF, preview) and `sceneToSVG()` render the same list, so every style is
written once. The QR block (modules + quiet zone of 2, 4 or 6 modules, `opts.quietZone`) is drawn
by the core, never by a template, and text overlapping it is dropped — templates cannot break
scannability.

Logo (`opts.logoBackground`): `clear` (default) removes the modules behind the logo plus half a
module of margin, but never structural modules (`isStructuralModule()` in `shapes.js`: finders
with separators, format information, timing and alignment patterns — the alignment table is
checked against the vendored library); `plate` draws a white plate; `none` draws the logo on top.
With a logo the code is at least version 3 (`LOGO_MIN_VERSION` in `js/app.js`): versions 1–2 have
too few data modules, and short payloads with a logo did not scan.

Transparent export (`opts.transparent`, PNG/SVG downloads only, never preview or PDF): the page
background and the QR background are left out, except when the template sets
`blockOnPaper: true` (card, polaroid, stamp) — there the QR keeps its background on the paper.
The background colour then only feeds the contrast checks, so the preview and the scan
self-test show the code on the surface the user said it will be placed on.

### QR shapes and colours (`js/render/shapes.js`)
- `MODULE_SHAPES`: square, rounded, dots, fluid, classy, diamond, smallSquares, hexagons, plus,
  hearts, vlines, hlines. Each returns
  SVG path data for all data modules (`pathD(isDark, n, x0, y0, cell)`); neighbour-aware shapes
  query `isDark(row ± 1, col ± 1)`, which is `false` outside the code and inside the eyes.
- `EYE_STYLES`: the three finder patterns as **tested pairs** of an `EYE_FRAME_SHAPES` ring and an
  `EYE_BALL_SHAPES` centre (square, rounded, roundedDot, circle, circleRounded, leaf, leafDot,
  pointed), drawn with `fillRule: "evenodd"` (so shapes inside one eye must not overlap).
  Frame and centre functions get `(x, y, cell, corner)`; `corner` (0 top-left, 1 top-right,
  2 bottom-left) lets `pointed` aim its sharp corner at the middle of the code. They are pairs
  on purpose: a square ring around a round centre (and similar mixes) broke decoding for
  30–90 % of the tested codes when combined with dots or lines. A ring of separate dots was
  tried and dropped (up to 65 % failures).
- `qrPaint()` returns a flat colour or a gradient object (`linear`/`radial`, user-space
  coordinates spanning the code) that both renderers understand. `GRADIENT_TYPES` has fixed
  directions plus `angle` (`opts.gradientAngle`, 0° = left to right, 90° = top to bottom,
  cleaned by `normalizeAngle()`; the end points always reach the corners of the code). Optional `eyeColor` paints
  the eyes separately. The contrast warning checks every colour in use against the background.
- Measured, not guessed: the dot radius (0.5), diamond radius (0.68), round centre (1.65 modules),
  line inset (0.05), small-square inset (0.07; 0.1 failed with gradients), hexagon radius
  (0.62), plus-sign arm (0.55) and heart scale (1.3; hearts overlap their neighbours, smaller
  ones only decoded with warnings) were tuned with the scan self-test over many sizes and payloads. Do not
  shrink them for looks without re-running the tests.
- Deliberately not offered: whole-code silhouettes (the entire code shaped like a heart, star or
  animal) and heavily decorated eyes — they depend on error correction to scan at all. Small
  shapes per module (like `hearts`) are fine when they pass the scan tests.

### Design files (`js/core/design.js`, `js/ui/design-file.js`)
"Save design" writes `qr-design.json`: `{ format: "offline-qr-tools/design", version: 1, style, logo? }`.
`style` holds only the controls listed in `DESIGN_FIELDS` (keys = control ids). **Content is never
stored** — no SSID, password, URL, contact details, and no heading or caption text (a user may
have typed a secret there); a unit test checks the design code never touches those fields.
Opening a file treats it as hostile: size cap before reading, `JSON.parse` only, every field
validated by kind (hex, bool, int range, enum against the options that exist in the form),
unknown keys ignored, prototype keys inert. The logo must be a base64 PNG within the logo size
cap and goes through `decodeLogoBuffer()` (sniff → decode → dimension cap → re-encode) **before** anything
is applied: a file with a bad logo changes nothing (`errDesignLogo`). Bump
`DESIGN_VERSION` only for incompatible changes; new optional fields need no bump.

### Frame templates (`FRAME_TEMPLATES` in `js/render/templates.js`)
`none`, `border`, `rounded`, `dashed`, `double`, `brackets` (viewfinder corners), `card`,
`polaroid`, `stamp` (perforated edges), `ribbon`, `bubble`. Each has
`build(M, o, tx)` → `{ h, block, back, front, pageColor }`. `ownsText: true` means the template
decides where text goes.

### Scan self-test (`js/ui/scan-check.js`: `verifyScan`, `scheduleScanCheck`)
After each change the preview is decoded locally with jsQR and compared **byte-for-byte** with
the payload: normal read at ~6 px/module (must pass), inverted read (warn), downscaled to
~3 px/module (warn). Status in `#scanStatus`. Download asks for confirmation when it fails; it
first runs the pending debounced update and a waiting check (`runPendingScanCheck()`), so a click
right after a change neither exports stale content nor skips the confirmation. A preview that is
replaced (demo, error) cancels its waiting check (`cancelScanCheck()`).

### Light and dark theme (`css/app.css`)
The page follows the operating system (`prefers-color-scheme`, e.g. the Windows "Choose your
mode" setting); there is no in-app switch and nothing is stored. All UI colours are CSS
variables defined once per theme at the top of `css/app.css` — use the variables, never new
hard-coded colours. **Output never follows the theme:** the QR preview, the logo preview and
the print preview sit on `--paper` (always white), and PNG/SVG/PDF exports and print layouts
are drawn by the renderers with their own colours. A test checks that the exported PNG and
the print preview are byte-identical in light and dark mode. Printing the page itself
(Ctrl+P) uses the light theme via `@media print`, which also hides the password field (it may be
plain text after "Show" or "Create a strong password").

### Print layouts (`js/print-layouts.js`)
A layout builds a page model in millimetres (`image`, `text`, `rect`, `line`) rendered by both
`pageToPdf()` (jsPDF) and `pageToCanvas()` (preview). QR artwork is embedded at ≥ 300 dpi.
Physical module size is checked (warn < 0.6 mm, fail < 0.4 mm). Text outside Windows-1252
(PDF standard fonts) is drawn as an image instead of producing wrong glyphs.

### Language selection (`js/ui/i18n.js`, `resolveLanguage()` in `js/core/util.js`)
Start language: `?lang=xx` in the link → the user's saved choice → `navigator.languages`
(`en-GB` matches `en`) → English. A manual choice in the picker is saved in `localStorage`
(key `offline-qr-tools.lang`, the language code only — the only thing the app ever stores).
Never store form content (SSID, password, contact details…) in `localStorage` or anywhere else.

### Events between modules
- `preview:rendered` — fired by `renderPreview()` after every redraw.
- `qrtype:changed` — fired by `setQrType()` when the content type changes.
- `i18n:applied` — fired by `applyI18n()` after a language switch.

## How to …

**Add a language:** copy `lang/en.js` to `lang/<code>.js`, translate every value, set
`langName` (in that language) and `flagCode`, add `assets/flags/<flagCode>.svg`, add a
`<script src="lang/<code>.js">` line in `index.html`. Nothing else.

**Add a QR content type:**
1. Add a pure builder to `QR_TYPES` in `js/core/qr-types.js` (validate and escape everything;
   return a non-secret `summary`) and unit tests in `tests/unit/qr-types.test.js`, including
   injection attempts.
2. Add a radio to `.type-picker` and a `.type-panel[data-type=…]` in `index.html`.
3. Add a reader to `TYPE_READERS`, a demo input to `demoInput()` and error→field mappings to
   `ERROR_FIELDS` in `js/app.js`.
4. Add i18n keys in every language: `type<Id>`, field labels, errors, `caption<Id>`,
   `printHeading<Id>`, `printSummaryLabel<Id>`.
5. Add an end-to-end case to `tests/e2e/qr-types.spec.js` (the PNG must decode to the payload).

**Add a dot shape or corner style:** add an entry to `MODULE_SHAPES` or `EYE_STYLES` in
`js/render/shapes.js` with a `labelKey`, and that key to every language file. The select
options, whitelist and scan tests pick it up automatically; keep the shape only if
`npm test` (every shape × corner style × gradient is decoded) passes without loosening it.
Presets live in `QR_STYLE_PRESETS` in `js/app.js`.

**Add a style option:** if it should be part of saved designs, add its control id to
`DESIGN_FIELDS` in `js/core/design.js` with the right kind.

**Generate passwords or other secrets:** only with `crypto.getRandomValues` and rejection
sampling (see `js/core/password.js`); never `Math.random` (a unit test checks).

**Add a ready-made caption text:** add an entry to `CAPTION_SUGGESTIONS` in `js/app.js` (its
key and the content types it fits, `"*"` for all) and the key to every language file.

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

- `tests/unit/` (Node's built-in `node:test`): every content type's format, escaping and
  injection resistance, password/SSID rules,
  sanitizing, i18n key parity, **static security rules** (CSP, no inline code, no remote URLs
  except QR payload links listed one by one in `QR_PAYLOAD_URLS` with a reason,
  no `innerHTML`/`eval`/`fetch`, print code never reads the password) and vendor checksums.
- `tests/e2e/` (Playwright): every test runs inside guards that **fail it on any external network
  request, CSP violation or console error**. Covers every content type end to end, dangerous
  URLs, deep links, the scan self-test, exact decoding of the PNG
  export, every frame × dot shape and every dot shape × corner style × gradient, logo backgrounds
  at every logo size (including large codes with a central alignment pattern), error correction
  levels, quiet zones, transparent exports, saving/opening design files (and hostile ones), password never in SVG/PDF output, logo upload hardening,
  language switch, all print layouts (every QR on the page decoded), `file://` usage and
  WCAG 2.1 A/AA via axe-core in light and dark mode (and identical exports in both).
- CI (`.github/workflows/ci.yml`) runs the tests, the site build and `tools/Check-Dependencies.ps1`
  on every push/PR and weekly. `pages.yml` publishes `main` to GitHub Pages after the tests;
  `release.yml` turns a `v*.*.*` tag into a GitHub release (tag must equal `package.json` version
  and have a `CHANGELOG.md` section). A new runtime folder or root file must be added to the
  lists in `tools/build-site.sh` — the script fails if `index.html` references something missing.

Rules for changes:
1. `npm test` must pass. Add or update tests for every behaviour change; a new rule in this file
   should get a static test in `tests/unit/security-static.test.js` when it can be checked.
2. Never weaken a guard or a security test to make a change pass — fix the change.
3. Still scan real printouts/exports with an iPhone and an Android phone before a release,
   using `docs/device-testing.md`; the tests decode with jsQR, not with phone cameras.
4. Dependencies touched: run `tools/Check-Dependencies.ps1` (exit code 0 or 1).
5. Add user-visible changes to `CHANGELOG.md` under "Unreleased".

## Conventions

- 2-space indentation, double quotes in JS, `"use strict"`, `function` declarations for top-level
  helpers, short comments explaining **why**, not what.
- Line endings are defined in `.gitattributes`; charset UTF-8 without BOM.
- `tools/*.ps1` must stay **ASCII-only** (Windows PowerShell 5.1 misreads UTF-8 without BOM) and
  compatible with PowerShell 5.1 (no `??`, ternary or `-AsHashtable`).
- Keep functions small and single-purpose; prefer extending the scene/page models over adding
  special cases to the renderers.

## Known quirks (do not "fix" these back)

- jQuery 4 removed `$.trim`, `$.isArray` and similar helpers — use plain JS (a unit test checks).
- jsQR 1.4.0: `inversionAttempts: "onlyInvert"` never builds the inverted image — use
  `"invertFirst"`; it can also throw on images without finder patterns — treat as "not decoded".
- jsPDF 4: `addImage` without a compression argument embeds bitmaps uncompressed (~7 MB);
  always pass `"SLOW"`.
- jsPDF standard fonts only cover Windows-1252; `isWinAnsi()` routes other text to images.
- OpenCV's QR decoder cannot decode emoji in UTF-8 payloads; verify with jsQR instead.
- Files written by some AI tools get a C2PA `<metadata>` block (e.g. in SVGs). It is harmless
  but should be stripped from committed assets.
