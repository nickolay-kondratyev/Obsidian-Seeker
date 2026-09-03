#!/usr/bin/env bash
# Provision a REAL Obsidian binary for the e2e suite (see e2e/obsidianHarness.ts).
#
# WHY this exists: `npm run test:e2e:obsidian` drives a real Obsidian (Electron),
# but the binary is NOT an npm dependency. On Linux / Docker this downloads a
# PINNED Obsidian release once, caches it, and prints the binary path on stdout
# so `run-e2e-obsidian.sh` can export OBSIDIAN_PATH. All progress goes to stderr
# so stdout stays a single clean path line for `$(...)` capture.
#
# WHY the tarball (not the AppImage): it extracts to a plain directory with a
# runnable `obsidian` binary — no FUSE and no `--appimage-extract`, both of which
# CI/Docker containers lack (no fusermount).
#
# Pinned on purpose: the harness behaviour is verified against this version, and
# a floating "latest" would let a new Obsidian release break e2e with NO code
# change. Bump the DEFAULT deliberately; `OBSIDIAN_VERSION` overrides for ONE run
# (e.g. smoke-test a newer build). The cache is keyed by version so builds coexist.
#
# WHY-NOT integrity checksum: Obsidian publishes a hash only for the `.asar`
# payload, not the platform tarball; `curl --fail` + `tar` validity is the 80/20
# guard. Revisit if a pinned asset is ever re-published.
#
# Non-Linux: no auto-download (Obsidian ships .dmg/.exe, not a drop-in binary).
# Set OBSIDIAN_PATH yourself — see obsidianHarness.resolveObsidianPath().
set -euo pipefail

# Default = manifest.json minAppVersion.
OBSIDIAN_VERSION="${OBSIDIAN_VERSION:-1.12.7}"

# Shared across checkouts; override with OBSIDIAN_CACHE_DIR. In Docker, mount
# this path as a volume so the download survives container rebuilds.
CACHE_DIR="${OBSIDIAN_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/obsidian-e2e}"

# All human-facing output → stderr; stdout is reserved for the final binary path.
log() { echo "setup-obsidian-bin: $*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
	log "auto-download is Linux-only (got $(uname -s))."
	log "Set OBSIDIAN_PATH to a local Obsidian binary and re-run. See README e2e section."
	exit 1
fi

case "$(uname -m)" in
	x86_64 | amd64) asset="obsidian-${OBSIDIAN_VERSION}.tar.gz" ;;
	aarch64 | arm64) asset="obsidian-${OBSIDIAN_VERSION}-arm64.tar.gz" ;;
	*)
		log "unsupported arch: $(uname -m)"
		exit 1
		;;
esac

# The tarball's single top-level dir == asset name without `.tar.gz`.
binary="${CACHE_DIR}/${asset%.tar.gz}/obsidian"

if [[ -x "${binary}" ]]; then
	log "using cached binary (Obsidian ${OBSIDIAN_VERSION})."
	echo "${binary}"
	exit 0
fi

url="https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/${asset}"
tarball="${CACHE_DIR}/${asset}"
mkdir -p "${CACHE_DIR}"

log "downloading Obsidian ${OBSIDIAN_VERSION}: ${url}"
curl --fail --location --show-error --silent --output "${tarball}" "${url}"
log "extracting ${asset}"
tar -xzf "${tarball}" -C "${CACHE_DIR}"
rm -f "${tarball}" # keep only the extracted tree (~200MB binary), not the archive

if [[ ! -x "${binary}" ]]; then
	log "expected binary missing after extract: ${binary}"
	exit 1
fi

log "ready."
echo "${binary}"
