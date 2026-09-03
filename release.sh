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
#   4. Push — push the branch and tag to origin in ONE atomic push. Pushing the
#      tag fires .github/workflows/release.yml, which rebuilds the assets and
#      publishes the GitHub Release. This is the default because a tag left
#      unpushed is a release that silently never happened (see GOTCHA). Pass
#      --no-push to stop after tagging; the script then prints the exact push
#      command to run when you are ready.
#
# GOTCHA — the tag is what publishes, and a plain `git push` does NOT push
# tags. Pushing only the version commit leaves GitHub with "No releases
# published". Preflight refuses to cut a new version while the current
# version's tag is still unpushed, so that mistake surfaces instead of piling up.
#
# Usage:
#   ./release.sh [patch|minor|major] [--no-push]
#
# Escape hatch: set RELEASE_ALLOW_BRANCH=1 to release from a branch other than
# main (rarely correct — normally a release commit belongs on main).

set -euo pipefail

readonly MAIN_BRANCH="main"

part="patch"
push=1

parse_args() {
  for arg in "$@"; do
    case "${arg}" in
      patch | minor | major) part="${arg}" ;;
      --no-push) push=0 ;;
      -h | --help)
        # Print the usage block above (the leading comment lines) and exit.
        sed -n '2,/^set -euo/{/^set -euo/!p}' "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *)
        echo "release.sh: unknown argument [${arg}]" >&2
        echo "usage: ./release.sh [patch|minor|major] [--no-push]" >&2
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

  refuse_unpushed_current_tag
}

# The tag of the version currently in package.json is the previous release's
# tag. If it exists locally but not on origin, that release was never published
# (see GOTCHA above) — refuse, and say exactly how to publish it.
refuse_unpushed_current_tag() {
  local tag
  tag="$(current_version)"
  if ! git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null; then
    return 0 # no local tag for this version (e.g. first release) — nothing to check
  fi
  if [[ -z "$(git ls-remote --tags origin "refs/tags/${tag}")" ]]; then
    die "tag [${tag}] exists locally but was never pushed, so its GitHub Release was never published.
Publish it first (this fires the release workflow):
  git push origin ${tag}
Or drop it if it was a mistake:
  git tag -d ${tag}"
  fi
}

current_version() {
  node -p "require('./package.json').version"
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
  version="$(current_version)"
  tag="${version}"
  branch="$(git rev-parse --abbrev-ref HEAD)"

  if [[ "${push}" == "1" ]]; then
    step "Push ${branch} + tag ${tag}"
    # One atomic push: either both the commit and the tag land, or neither.
    # Pushing them separately can leave the commit on origin with no tag — and
    # it is the tag that publishes the release.
    git push --atomic origin "${branch}" "${tag}"
    echo
    echo "Pushed. GitHub Actions (release.yml) is now building and publishing the release."
    echo "It will appear here once the run finishes:"
    echo "  https://github.com/nickolay-kondratyev/Obsidian-Seeker/releases"
  else
    step "Tagged ${tag} locally — NOT pushed, NO release yet"
    echo "The GitHub Release is created by pushing the TAG. A plain 'git push' pushes"
    echo "only the commit and leaves GitHub with 'No releases published'."
    echo "Push both when ready (this fires the release workflow):"
    echo "  git push --atomic origin ${branch} ${tag}"
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
