#!/usr/bin/env bash
# Download one model version's files and keep only files whose SHA-256
# checksum matches ml/model_contract/<version>/model-<version>.sha256. Linux
# counterpart of scripts/fetch-model.ps1 (same releases, same checks).
#   scripts/fetch-model.sh            model v2 (v1.4.0 and later)
#   scripts/fetch-model.sh v1         model v1, to roll back to v1.3.0-rc1
#   scripts/fetch-model.sh <version> [release-url] [target-dir]
#
# The model files are never committed to Git. They are attached to the GitHub
# Releases "model-v1" and "model-v2".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-v2}"
case "$VERSION" in
  v1|v2) ;;
  *) echo "Unknown model version: $VERSION (use v1 or v2)." >&2; exit 1 ;;
esac
RELEASE_URL="${2:-https://github.com/Myranyamwanda/Salesmesh/releases/download/model-$VERSION}"
TARGET="${3:-$ROOT/backend/models/$VERSION}"
CHECKSUM_FILE="$ROOT/ml/model_contract/$VERSION/model-$VERSION.sha256"

mkdir -p "$TARGET"
rejected=()

# Each line is "<sha256>  <file name>".
while read -r expected name; do
  [ -z "${expected:-}" ] && continue
  expected="$(echo "$expected" | tr 'A-F' 'a-f')"
  destination="$TARGET/$name"

  if [ -f "$destination" ]; then
    if [ "$(sha256sum "$destination" | cut -d' ' -f1)" = "$expected" ]; then
      echo "ok        $name (already present)"
      continue
    fi
    # Never keep a file that does not match, even an old local copy.
    rm -f "$destination"
    echo "WARNING: $name did not match its checksum and was removed." >&2
  fi

  download="$destination.download"
  if ! curl -fsSL --retry 3 -o "$download" "$RELEASE_URL/$name"; then
    rm -f "$download"
    echo "WARNING: could not download $name" >&2
    rejected+=("$name")
    continue
  fi

  actual="$(sha256sum "$download" | cut -d' ' -f1)"
  if [ "$actual" != "$expected" ]; then
    rm -f "$download"
    echo "WARNING: $name has checksum $actual, expected $expected. It was not saved." >&2
    rejected+=("$name")
    continue
  fi
  mv -f "$download" "$destination"
  chmod 644 "$destination"
  echo "verified  $name"
done < <(tr -d '\r' < "$CHECKSUM_FILE")

if [ "${#rejected[@]}" -gt 0 ]; then
  echo "Not saved: ${rejected[*]}. Check the model-$VERSION release assets." >&2
  exit 1
fi
echo "All model $VERSION files are in $TARGET and match model-$VERSION.sha256."
