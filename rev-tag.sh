#!/usr/bin/env bash
#
# rev-tag.sh — bump the version, commit and tag it. No gates, no push, no release.
#
# Thin wrapper over `release.sh --tag-only`, which owns the preflight and the bump
# logic (see its header). Pushing the tag later DOES publish a release.
#
# Usage:
#   ./rev-tag.sh [patch|minor|major]   (default: patch)
set -euo pipefail

exec "$(dirname "$0")/release.sh" "$@" --tag-only
