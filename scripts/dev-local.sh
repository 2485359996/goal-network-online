#!/usr/bin/env bash
set -euo pipefail

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm dev
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm dev
fi

echo "pnpm is required. Install pnpm or enable Corepack, then rerun this script." >&2
exit 1
