#!/usr/bin/env bash
# Download the model v1 files and keep only files whose SHA-256 checksum
# matches ml/model_contract/model-v1.sha256. Linux counterpart of
# scripts/fetch-model.ps1 (same release, same checks).
#   scripts/fetch-model.sh [release-url] [target-dir]
#
# The model files are never committed to Git. They are attached to the GitHub
# Release "model-v1".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_URL="${1:-https://github.com/Myranyamwanda/Salesmesh/releases/download/model-v1}"
TARGET="${2:-$ROOT/backend/models/v1}"
CHECKSUM_FILE="$ROOT/ml/model_contract/model-v1.sha256"

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
  echo "Not saved: ${rejected[*]}. Check the model-v1 release assets." >&2
  exit 1
fi
echo "All model v1 files are in $TARGET and match model-v1.sha256."
