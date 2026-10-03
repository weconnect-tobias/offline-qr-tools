# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Content types: web address, text, e-mail, phone, SMS, contact card (vCard), location,
  calendar event and Swish payment, next to Wi-Fi.
- Swish: the same link as Swish's own generator, separate locks for amount and message, and
  Swish's recommended looks with the Swish symbol (black code with colour symbol, black and
  white, colour gradient).
- Strong Wi-Fi password generator (crypto random, 116 bits, no look-alike characters).
- Styles: 12 dot shapes, 8 corner styles, gradients (fixed directions, custom angle, radial),
  custom corner colour, quick styles, and frames including double, viewfinder, Polaroid and
  postage stamp.
- Logo with an empty area behind it (structural patterns are kept), white plate or none.
- Advanced: error correction level and quiet zone; transparent PNG/SVG export.
- Ready-made caption texts per content type.
- Save and open designs as a file (appearance only, never content).
- Light and dark mode following the operating system; exports and prints stay white.
- Language follows the browser (Swedish/English) with a remembered manual choice.
- Device test checklist (`docs/device-testing.md`), `SECURITY.md`.

### Security
- Strict CSP with no network access; hardened logo pipeline; design files validated field by
  field; static tests for the security rules.

## [1.0.0]

- First version: Wi-Fi QR codes with styling, scan self-test, PNG/SVG/PDF export and print
  layouts.
