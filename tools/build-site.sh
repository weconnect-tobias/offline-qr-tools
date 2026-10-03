#!/usr/bin/env bash
# Builds the publishable app into dist/site (for GitHub Pages) and, with --zip <version>,
# dist/offline-qr-tools-<version>.zip plus a SHA-256 checksum file (for releases).
#
# The app has no build step: this only COPIES the files the browser needs, so the published
# site and the zip contain exactly what is in the repository — nothing generated, no tooling,
# no tests. The script fails if index.html references a file that is not in the output.
set -euo pipefail

cd "$(dirname "$0")/.."
command -v zip >/dev/null || [ "${1:-}" != "--zip" ] || { echo "zip is required for --zip" >&2; exit 1; }
OUT=dist/site
rm -rf dist
mkdir -p "$OUT"

# Runtime files only. Keep in sync with index.html (checked below).
FILES=(index.html LICENSE README.md SECURITY.md CHANGELOG.md)
DIRS=(css js lang assets vendor)

for f in "${FILES[@]}"; do cp "$f" "$OUT/"; done
for d in "${DIRS[@]}"; do cp -R "$d" "$OUT/"; done

# Every local file referenced by index.html (outside HTML comments) must exist in the output.
missing=0
while IFS= read -r ref; do
  case "$ref" in http:*|https:*|data:*|\#*|"") continue ;; esac
  if [ ! -e "$OUT/$ref" ]; then echo "missing in output: $ref" >&2; missing=1; fi
done < <(perl -0pe 's/<!--.*?-->//gs' index.html | grep -oE '(src|href)="[^"]+"' | sed -E 's/^(src|href)="([^"]+)"$/\2/')
[ "$missing" -eq 0 ] || exit 1

# Nothing that only belongs to development may slip in.
if find "$OUT" \( -name node_modules -o -name tests -o -name '*.spec.js' -o -name '*.test.js' -o -name package.json \) | grep -q .; then
  echo "development files found in output" >&2; exit 1
fi

echo "Site built in $OUT ($(find "$OUT" -type f | wc -l) files)"

if [ "${1:-}" = "--zip" ]; then
  VERSION="${2:?usage: build-site.sh --zip <version>}"
  NAME="offline-qr-tools-$VERSION"
  cp -R "$OUT" "dist/$NAME"
  (cd dist && zip -qr -X "$NAME.zip" "$NAME" && sha256sum "$NAME.zip" > "$NAME.zip.sha256")
  echo "Release archive: dist/$NAME.zip"
fi
