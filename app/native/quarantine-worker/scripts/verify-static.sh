#!/bin/sh
set -eu

worker="${1:-target/x86_64-unknown-linux-gnu/release/cbb-quarantine-worker}"
test -f "$worker"
test -x "$worker"

if readelf -lW "$worker" | grep -q 'INTERP'; then
  echo "quarantine worker has a dynamic ELF interpreter" >&2
  exit 1
fi

if ldd "$worker" 2>&1 | grep -Evq 'not a dynamic executable|statically linked'; then
  echo "quarantine worker has dynamic dependencies" >&2
  ldd "$worker" >&2 || true
  exit 1
fi

"$worker" --probe
