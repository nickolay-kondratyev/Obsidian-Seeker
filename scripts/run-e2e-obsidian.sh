#!/usr/bin/env bash
# Entry point for the real-Obsidian Playwright e2e suite (`npm run test:e2e:obsidian`).
#
# Ensures a real Obsidian binary is available before running: when OBSIDIAN_PATH
# is unset it auto-downloads a pinned build via setup-obsidian-bin.sh (Linux /
# Docker); an already-set OBSIDIAN_PATH is honoured untouched. Then builds the
# plugin (the harness assembles the vault from e2e/datasets + main.js) and runs
# Playwright. Extra args pass through, e.g.
#   npm run test:e2e:obsidian -- search.e2e.ts
#
# Type-checking of e2e/** is NOT done here: root `npm run typecheck` covers it
# (root tsconfig `include` lists e2e/**; e2e/tsconfig.json serves editors only).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if [[ -z "${OBSIDIAN_PATH:-}" ]]; then
	OBSIDIAN_PATH="$(bash scripts/setup-obsidian-bin.sh)"
	export OBSIDIAN_PATH
fi

# Headless environments (Docker / CI) have no display server, so Electron must
# render via Chromium's offscreen Ozone backend or it dies on boot ("Missing X
# server or $DISPLAY"). Default those flags when NO display is detected; an
# explicit OBSIDIAN_E2E_EXTRA_ARGS always wins (override for a real/GPU display).
# Linux ONLY: macOS has no $DISPLAY either, and `--ozone-platform=headless` is a
# Linux-only Chromium flag — on the macOS release host Obsidian runs windowed.
if [[ "$(uname -s)" == "Linux" && -z "${OBSIDIAN_E2E_EXTRA_ARGS:-}" && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
	export OBSIDIAN_E2E_EXTRA_ARGS="--ozone-platform=headless --disable-gpu"
	echo "run-e2e: no display detected — using headless Obsidian flags: ${OBSIDIAN_E2E_EXTRA_ARGS}" >&2
fi

mkdir -p .tmp && npm run build > .tmp/e2e-build.log 2>&1
exec npx playwright test --config e2e/playwright.config.ts "$@"
