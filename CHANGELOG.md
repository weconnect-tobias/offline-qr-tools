# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Short codes with a logo (e.g. a one-word text) could not be scanned; with a logo a code is now
  at least version 3, and the format information next to the corners is never covered.
- Logo loading: removing a logo while it was still loading, or picking a Swish look during a
  load, could bring back the old logo; an old error could stay next to a valid logo.
- A design file with an invalid logo now changes nothing and shows the error in the design
  section (it used to apply the style, remove the current logo and report success).
- Downloading right after typing exported the previous content, and could skip the "cannot be
  scanned" question while the self-test was still running. The same for the print PDF.
- The scan result of a replaced code could appear under the example code.
- Single-code PDF: a large width (e.g. 250 mm on A4) put the code partly outside the page; it is
  now shrunk to fit inside a 10 mm margin.
- SVG export: control characters in a heading or caption made the file unreadable; repeated
  spaces are kept, and gradients get unique ids so several SVGs can share one web page.
- Long headings, captions and print texts could cut an emoji in half.
- Printing the page itself (Ctrl+P) could show the Wi-Fi password after "Show" or "Create a
  strong password". Printing the page also uses the light colours for every element now.
- Enterprise Wi-Fi: "anonymous outer identity" dropped the username, so the code could not log
  in. The username is now always included and the anonymous identity is added to it.
- Location: very small coordinates were written as `1e-7`, which maps apps do not accept.
- Calendar events now include `PRODID`, `UID` and `DTSTAMP`, as the iCalendar standard requires.
- Web address: `example.com:8080/menu` was rejected as an unknown scheme; very long addresses
  with non-Latin characters were not capped.
- Contact card: the website was escaped like text (`\,`), which broke some links.
- E-mail: addresses with `#` or `%` are rejected (they changed the recipient in mail apps), and
  line breaks in the message are written as the standard requires.
- Swish: a phone number with another country code than +46 was accepted as a 90 account.
- Half an emoji (from a broken paste) no longer stops the preview from updating.
- Errors now mark every field that can be wrong (latitude and longitude, date and time).
- Choosing a language with the keyboard keeps the focus on the language button; tabbing out of
  the language list closes it.
- The PDF error message no longer tells the user to check the internet connection (the app never
  uses it).
- Swedish texts: "Utseenden som Swish rekommenderar", "Swishs riktlinjer", and the dot shape
  "Elegant (bladhörn)" no longer has the same name as the "Klassisk" quick style.

### Changed
- The release zip is reproducible: the same commit always gives the same file and checksum.

## [1.1.0] - 2026-10-03

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
- Publishing to GitHub Pages and release zips with a SHA-256 checksum (`tools/build-site.sh`).

### Security
- Strict CSP with no network access; hardened logo pipeline; design files validated field by
  field; static tests for the security rules.

## [1.0.0]

- First version: Wi-Fi QR codes with styling, scan self-test, PNG/SVG/PDF export and print
  layouts.
