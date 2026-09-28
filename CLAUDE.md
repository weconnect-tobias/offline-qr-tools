# CLAUDE.md

All project guidance lives in AGENTS.md so every AI tool reads the same rules:

@AGENTS.md

The most important rules, repeated because they must never be broken:

- The app must make **no network requests** (the CSP in `index.html` enforces this).
- The Wi-Fi **password is never shown as readable text** in any output — only inside the QR code.
- No inline scripts or styles; sanitize/escape all input; every UI string in every `lang/*.js` file.
