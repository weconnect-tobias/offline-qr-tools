# Offline QR Tools

[![CI](https://github.com/weconnect-tobias/offline-qr-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/weconnect-tobias/offline-qr-tools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

QR code tools that run entirely in your browser — **nothing is ever sent anywhere**.

Create styled, print-ready QR codes for **Wi-Fi**, **web addresses**, **text**, **e-mail**, **phone**,
**SMS**, **contact cards (vCard)**, **locations**, **calendar events** and **Swish payments**. Swedish and English UI.

## Features

- **Wi-Fi**: WPA/WPA2/WPA3, WEP, open networks, WPA2-Enterprise (EAP), hidden networks, and a built-in
  generator for strong passwords (created locally with the browser's secure random source)
- **Web address**: only `http`/`https`; blocks `javascript:` links and `user@host` phishing tricks,
  warns about unencrypted `http` and look-alike (punycode) domains
- **Text**, **e-mail** (recipient, subject, message), **phone**, **SMS**, **contact card**
  (vCard 3.0), **location** (coordinates) and **calendar event** (title, place, start/end or
  all day, description — opens "add to calendar" on the phone)
- **Swish**: mobile number, company Swish number or 90 account, with optional amount and message
  (locked or editable by the payer) — opens the Swish app straight from the phone camera, with
  Swish's recommended look (black code with the colour symbol, black and white, or a colour
  gradient) — the Swish symbol is added automatically
- Direct links to a type, e.g. `index.html#url` or `index.html#vcard`
- Opens in your browser's language (Swedish or English, otherwise English), remembers a manual
  choice, and `?lang=sv` / `?lang=en` in a link forces a language
- Styling: 12 dot shapes (squares, small squares, rounded, circles, flowing, classy, diamonds,
  hexagons, plus signs, hearts, vertical and horizontal lines), 8 corner styles, color gradients
  (fixed directions, a custom angle or radial), a separate corner color, quick styles (Classic, Modern, Elegant, Playful,
  Minimal, Retro), logo, and frames: border, double, dashed, viewfinder corners, card, Polaroid,
  postage stamp, ribbon and speech bubble. Every shape combination is decode-tested.
- Logo with an empty area behind it (the modules are removed, the code's positioning patterns
  are kept), a white plate, or straight on top
- Advanced: error correction level (automatic, or L/M/Q/H; always H with a logo) and the margin
  around the code (2, 4 or 6 modules)
- Transparent background for PNG and SVG
- **Save and open designs** as a small file (`qr-design.json`) to reuse a look or share a company
  profile — shapes, colors, frame, logo and settings, never the content or texts
- Ready-made caption texts per content type ("Scan me!", "Free Wi-Fi – scan to connect",
  "Save the contact", …)
- **Scan self-test**: every design is decoded locally and checked byte-for-byte before you use it
- Export as PNG, SVG or PDF
- Print layouts: A4/Letter sign, folding table tent, business-card sheet (85 × 55 mm) with crop marks,
  including a check that the printed QR dots are large enough to scan
- Light and dark mode that follows your operating system (e.g. Windows' light/dark setting);
  downloads and printouts are always on white paper
- Accessible (WCAG 2.1 AA) and works offline

## Privacy and security

- **No network requests at all.** All code, fonts and icons are local, and a strict
  Content-Security-Policy (`connect-src 'none'`) makes the browser block any attempt.
- **The Wi-Fi password is never printed or shown as text** on anything the app produces. It only
  exists inside the QR code. (You can optionally print the network name, which is not secret.)
- Every content type validates and escapes its input so nothing can inject extra fields into the
  code (e.g. extra e-mail recipients or vCard entries).
- Design files only contain the appearance. Opened design files are validated field by field,
  and a logo inside one goes through the same checks as an uploaded logo.
- Uploaded logos are size-checked, type-checked by their file signature and re-encoded before use;
  SVG uploads are rejected.
- Third-party libraries are vendored and verified by checksum — see [`vendor/README.md`](vendor/README.md).

Keep in mind that anyone who scans the QR code can read the password from it. Use it for guest
networks, not for networks that give access to sensitive systems.

## Usage

- **Online:** <https://weconnect-tobias.github.io/offline-qr-tools/> — still runs entirely in
  your browser; nothing you type is sent anywhere.
- **Offline:** download `offline-qr-tools-<version>.zip` from
  [Releases](https://github.com/weconnect-tobias/offline-qr-tools/releases), check it against
  the `.sha256` file, unzip and double-click `index.html`. Nothing to install.
- **Your own server:** serve the unzipped folder from any static web server (see below).

## Hosting on a web server

The page already ships a Content-Security-Policy. Some protections can only be sent as HTTP
headers by the server; add these when hosting it:

**nginx** (in Plesk: *Apache & nginx Settings → Additional nginx directives*)

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**Apache** (`.htaccess`, requires `mod_headers`)

```apache
Header always set Content-Security-Policy "frame-ancestors 'none'"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "no-referrer"
Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

`frame-ancestors` prevents other sites from embedding the page (clickjacking); it is ignored when
set in a `<meta>` tag, which is why it must come from the server. Only send HSTS over HTTPS.

GitHub Pages cannot send these headers, so the online version relies on the page's own
Content-Security-Policy; host it yourself if you need `frame-ancestors`.

## Publishing (maintainers)

- **Site:** every push to `main` runs the tests and publishes to GitHub Pages
  (`.github/workflows/pages.yml`; one-time setup: Settings → Pages → Source "GitHub Actions").
- **Release:** set `version` in `package.json`, move the "Unreleased" notes in `CHANGELOG.md` to a
  new version section, commit, then `git tag v<version> && git push origin v<version>`. The
  release workflow tests, builds the zip with `tools/build-site.sh` and publishes it with a
  SHA-256 checksum and the changelog section as notes.

## Development and tests

The app needs no build step. The test suite needs Node.js 22+:

```sh
npm install
npx playwright install chromium
npm test
```

Unit tests cover the Wi-Fi payload, validation, escaping and static security rules; browser tests
run the real app and fail on any network request, CSP violation or console error. They also decode
every exported and printed QR code and verify that the password never appears as text.
See [`AGENTS.md`](https://github.com/weconnect-tobias/offline-qr-tools/blob/main/AGENTS.md#tests).

## Maintaining dependencies

```powershell
.\tools\Check-Dependencies.ps1          # check versions, advisories and checksums
.\tools\Check-Dependencies.ps1 -Update  # update (verified download, automatic rollback on error)
```

See [`vendor/README.md`](vendor/README.md).

## Testing on real phones

Before a release, go through [`docs/device-testing.md`](https://github.com/weconnect-tobias/offline-qr-tools/blob/main/docs/device-testing.md) with an iPhone
and an Android phone; the automated tests decode with a software decoder, not phone cameras.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md) — please report privately, not as a public issue.

## Contributing

Read [`AGENTS.md`](https://github.com/weconnect-tobias/offline-qr-tools/blob/main/AGENTS.md) first — it describes the architecture, the security rules every
change must respect, and how to add languages, frame styles and print layouts. The same file is
used as instructions by AI coding assistants.

## License

[MIT](LICENSE) © 2026 Tobias Sörensson

Bundled third-party libraries in `vendor/` keep their own licenses, included next to each file:
jQuery (MIT), qrcode-generator (MIT), jsQR (Apache-2.0) and jsPDF (MIT).

The Swish symbol in `assets/swish/` (and embedded in `js/assets/swish-symbols.js`) is a
trademark of Getswish AB and is **not** covered by the MIT license. It is included only for
Swish payment codes made according to Swish's guidelines — see
[`assets/swish/NOTICE.md`](assets/swish/NOTICE.md).
