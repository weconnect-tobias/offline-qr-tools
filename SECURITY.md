# Security policy

Offline QR Tools handles Wi-Fi passwords and other personal data, so security reports are very
welcome.

## What the app promises

- It makes **no network requests**; everything runs in the browser (enforced by a strict
  Content-Security-Policy).
- The **Wi-Fi password is never shown as readable text** in any export or printout — it only
  exists inside the QR code.
- Nothing is stored except the chosen language. Design files contain appearance only.

A way around any of these is a vulnerability, as is anything that lets crafted input (form
fields, logos, design files, the address bar) run code or change the encoded content.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
the repository's **Security** tab → **Report a vulnerability**.

Include what you did, what happened, and the browser and version. You will get an answer as
soon as possible; fixes are released with credit unless you prefer otherwise.

## Supported versions

Only the latest release and the `main` branch receive fixes.

## Scope notes

- Vendored libraries live in `vendor/` and are checked by `tools/Check-Dependencies.ps1`
  (versions, advisories, checksums). Reports about them are welcome too.
- Anyone who scans a Wi-Fi QR code can read the password from it. That is how Wi-Fi QR codes
  work, not a vulnerability; use guest networks for codes in public places.
