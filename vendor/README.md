# Vendored dependencies

The app ships all third-party code locally so it makes **no network requests at all**
(enforced by the Content-Security-Policy in `index.html`: `connect-src 'none'`, `script-src 'self'`).
Each file below is copied byte-for-byte from the package published on npm.

<!-- BEGIN GENERATED DEPENDENCY TABLE: edit vendor/manifest.json and run tools/Check-Dependencies.ps1 -SyncDocs -->
| Library | Version | File (in `vendor/`) | From npm | License | Used for | SHA-384 |
|---|---|---|---|---|---|---|
| jQuery | 4.0.0 | `jquery/jquery-4.0.0.min.js` | `dist/jquery.min.js` | MIT | DOM / events | `sha384-fgGyf7Mo7DURSOMnOy7ed+dkq5Job205Gnzu6QIg0BOHKaqt4D76Dt8VlDCzcMHV` |
| qrcode-generator | 2.0.4 | `qrcode-generator/qrcode-2.0.4.js` | `dist/qrcode.js` | MIT | QR matrix generation | `sha384-e9EFD6BGC90bkW9aDV5xbbBfzwN7G8YImHao2lfLVKV/hPB0E0go+H3I64h7oHtA` |
| jsQR | 1.4.0 | `jsqr/jsQR-1.4.0.js` | `dist/jsQR.js` | Apache-2.0 | Local scan self-test | `sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx` |
| jsPDF | 4.2.1 | `jspdf/jspdf-4.2.1.umd.min.js` | `dist/jspdf.umd.min.js` | MIT | PDF export | `sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3` |
<!-- END GENERATED DEPENDENCY TABLE -->

License texts are in each library's folder.

jsPDF was upgraded from 2.5.1 to 4.2.1 because 2.5.1 is affected by several published advisories
(e.g. GHSA-f8cm-6447-x5h2, GHSA-wfv2-pwc8-crg5). The app only uses `new jsPDF()`, `addImage()` with a
PNG it renders itself, and `save()`. jsPDF's optional dependencies (dompurify, html2canvas, canvg) are
only needed for `html()`/SVG features, are not vendored and are never loaded.
`npm audit` for the four packages above (without optional dependencies) reports 0 vulnerabilities.

## Verifying a file by hand

Checksums are listed in the table above and in `vendor/manifest.json`; the script verifies them automatically.
To verify a single file manually:

```sh
openssl dgst -sha384 -binary <file> | openssl base64 -A
```

## Checking for updates and vulnerabilities

The app itself **never** checks for updates: that would require network requests, which the
Content-Security-Policy forbids by design. Checks and updates are done by the developer with
`tools/Check-Dependencies.ps1` (Windows PowerShell 5.1 or PowerShell 7+, also `pwsh` on macOS/Linux).

```powershell
# Check: checksums, available updates and known advisories
.\tools\Check-Dependencies.ps1

# If script execution is blocked on the machine
powershell -ExecutionPolicy Bypass -File .\tools\Check-Dependencies.ps1

# Only verify checksums, no network
.\tools\Check-Dependencies.ps1 -Offline
```

Only package names and versions are sent to the npm registry. The advisory data is the same that
`npm audit` uses (sourced from GitHub Advisories).

| Exit code (check) | Meaning |
|---|---|
| 0 | Up to date, no known advisories, checksums OK |
| 1 | Newer version available, no known security issue |
| 2 | **Action required**: advisory affects an installed version, or a file was modified/missing |
| 3 | Check could not complete (network or manifest error) |

Suggested routine: run it monthly and always before publishing a release. The exit codes make it
usable in CI (e.g. a scheduled GitHub Actions job).

## Updating a dependency

```powershell
# Preview what would change (no files touched)
.\tools\Check-Dependencies.ps1 -Update -WhatIf

# Update everything within the current major versions (safe default)
.\tools\Check-Dependencies.ps1 -Update

# One package, across a major version (may contain breaking API changes)
.\tools\Check-Dependencies.ps1 -Update -Package jquery -AllowMajor

# Pin an exact version
.\tools\Check-Dependencies.ps1 -Update -Package jspdf -Version 4.2.1
```

What `-Update` does for each package:

1. Picks the newest non-deprecated release in the **same major version** (latest overall with
   `-AllowMajor`, or the exact `-Version`). Pre-releases are never selected.
2. **Refuses** the target if it is affected by a known security advisory.
3. Downloads the npm tarball and verifies it against the registry's **SHA-512 integrity** value.
4. Copies only the file named by `npmFile` in the manifest (plus the package's license) into `vendor/`
   under a versioned file name. If the package layout changed (e.g. the file moved in a new major
   version), the update stops and must be done manually.
5. Updates the `<script src>` in `index.html`, `vendor/manifest.json` and the generated table above,
   then removes the old file. **Any failure rolls back all changes** for that package.

After an update, always test the app: the scan self-test must report OK, and PNG/SVG/PDF export and
the language switch must work. For a major version, read the release notes first.

| Exit code (update) | Meaning |
|---|---|
| 0 | Requested updates applied, or nothing to update |
| 2 | At least one update refused or failed (that package was rolled back) |
| 3 | Update could not start (network, manifest or tooling error) |

### Manual update (if the script cannot be used)

1. `npm pack <name>@<version>` and extract the tarball.
2. Copy the file listed as `npmFile` into this folder under a versioned name, plus its license.
3. Update the `<script src>` in `index.html` and the entry in `vendor/manifest.json` (version, file, sha384),
   then run `.\tools\Check-Dependencies.ps1 -SyncDocs` to regenerate the table above.
4. Test the app as described above, then run the check — it must report checksums OK and no advisories.

### Where to look manually

| Library | Latest version | Release notes | Security advisories |
|---|---|---|---|
| jQuery | https://www.npmjs.com/package/jquery | https://github.com/jquery/jquery/releases | https://github.com/advisories?query=ecosystem%3Anpm+jquery |
| qrcode-generator | https://www.npmjs.com/package/qrcode-generator | https://github.com/kazuhikoarase/qrcode-generator | https://github.com/advisories?query=ecosystem%3Anpm+qrcode-generator |
| jsQR | https://www.npmjs.com/package/jsqr | https://github.com/cozmo/jsQR/releases | https://github.com/advisories?query=ecosystem%3Anpm+jsqr |
| jsPDF | https://www.npmjs.com/package/jspdf | https://github.com/parallax/jsPDF/releases | https://github.com/advisories?query=ecosystem%3Anpm+jspdf |

Note: GitHub Dependabot does not detect vendored files, so it will not warn about these libraries.
