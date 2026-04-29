#!/usr/bin/env bash
# Build the event-tap Swift binary into dist/demo/bin/event-tap.
# Idempotent — only recompiles when the source is newer than the binary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUT_DIR="$REPO_ROOT/dist/demo/bin"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build.sh: swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

build_one() {
  local name="$1"
  local src="$SCRIPT_DIR/$name.swift"
  local out="$OUT_DIR/$name"

  if [[ ! -e "$src" ]]; then
    echo "build.sh: source missing: $src" >&2
    exit 1
  fi

  if [[ -e "$out" && "$out" -nt "$src" ]]; then
    return 0
  fi

  swiftc -O -o "$out" "$src" \
    -framework Cocoa \
    -framework CoreGraphics \
    -framework ApplicationServices

  echo "build.sh: built $out"
}

build_one event-tap
build_one ax-debug
