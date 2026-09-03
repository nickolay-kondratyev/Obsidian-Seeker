#!/usr/bin/env bash
#
# release.sh — cut a new Seeker release from `main`.
#
# What it does, in order:
#   1. Preflight — must run from the repo root, on `main`, with a clean working
#      tree that is in sync with origin. A release built from a dirty or stale
#      tree is not reproducible, so we refuse rather than guess.
#   2. Basics — install deps (npm ci, from the lockfile), typecheck, test, build.
#      A release that does not build green never leaves this machine.
#   3. Bump — `npm version <part>` (default: patch). Via .npmrc (empty tag
#      prefix) and version-bump.mjs this rewrites manifest.json + versions.json,
#      commits all three, and tags the commit with the BARE version — no leading
#      "v", which Obsidian's installer and BRAT require to match manifest
#      "version" exactly.
#   4. Push — with --push, push the branch and tag to origin. Pushing the tag
#      fires .github/workflows/release.yml, which rebuilds the assets and
#      publishes the GitHub Release. Without --push the script stops after
#      tagging and prints the exact command to run when you are ready.
#
# Usage:
#   ./release.sh [patch|minor|major] [--push]
#
# Escape hatch: set RELEASE_ALLOW_BRANCH=1 to release from a branch other than
# main (rarely correct — normally a release commit belongs on main).

set -euo pipefail

readonly MAIN_BRANCH="main"

part="patch"
push=0

parse_args() {
  for arg in "$@"; do
    case "${arg}" in
      patch | minor | major) part="${arg}" ;;
      --push) push=1 ;;
      -h | --help)
        # Print the usage block above (the leading comment lines) and exit.
        sed -n '2,/^set -euo/{/^set -euo/!p}' "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *)
        echo "release.sh: unknown argument [${arg}]" >&2
        echo "usage: ./release.sh [patch|minor|major] [--push]" >&2
        exit 2
        ;;
    esac
  done
}

step() { printf '\n=== %s ===\n' "$1"; }
die() {
  echo "release.sh: $1" >&2
  exit 1
}

preflight() {
  step "Preflight"

  # Run from the repo root so npm scripts and relative paths resolve.
  cd "$(dirname "$0")"

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "${branch}" != "${MAIN_BRANCH}" && "${RELEASE_ALLOW_BRANCH:-0}" != "1" ]]; then
    die "on branch [${branch}], not [${MAIN_BRANCH}]. Release from ${MAIN_BRANCH}, or set RELEASE_ALLOW_BRANCH=1 to override."
  fi

  # A release must be reproducible from committed sources; refuse a dirty tree.
  # main.js and other build artifacts are gitignored, so they do not count.
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree is not clean. Commit or stash changes before releasing."
  fi

  # Make sure we are not tagging a commit that is already stale relative to
  # origin, which would ship an out-of-date build.
  git fetch --quiet origin "${branch}"
  local behind
  behind="$(git rev-list --count "HEAD..origin/${branch}")"
  if [[ "${behind}" != "0" ]]; then
    die "local ${branch} is ${behind} commit(s) behind origin. Pull first."
  fi
}

verify_basics() {
  step "Install (npm ci)"
  npm ci

  step "Typecheck"
  npm run typecheck

  step "Test"
  npm test

  step "Build"
  npm run build
}

bump_and_tag() {
  step "Bump version (${part})"
  # npm version: bumps package.json, runs the "version" script (version-bump.mjs
  # rewrites + git-adds manifest.json and versions.json), then commits and tags.
  npm version "${part}"
}

finish() {
  local version tag branch
  version="$(node -p "require('./package.json').version")"
  tag="${version}"
  branch="$(git rev-parse --abbrev-ref HEAD)"

  if [[ "${push}" == "1" ]]; then
    step "Push ${branch} + tag ${tag}"
    git push origin "${branch}"
    git push origin "${tag}"
    echo
    echo "Pushed. GitHub Actions (release.yml) is now building and publishing the release."
    echo "It will appear here once the run finishes:"
    echo "  https://github.com/nickolay-kondratyev/Obsidian-Seeker/releases"
  else
    step "Tagged ${tag} locally — not pushed"
    echo "Push when ready (this fires the release workflow):"
    echo "  git push origin ${branch} && git push origin ${tag}"
    echo "Or re-run with --push."
  fi
}

main() {
  parse_args "$@"
  preflight
  verify_basics
  bump_and_tag
  finish
}

main "$@"
