import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guards the release.sh preflight against the failure that motivated
// _tickets/releasesh-does-not-create-release-on-github.md: `npm version` tags
// locally, and a plain `git push` pushes the commit but NOT the tag, so the
// tag-triggered release workflow never fires and GitHub shows no release.
// Preflight must catch the current version's tag sitting unpushed and say how
// to fix it, instead of silently cutting the next version on top of it.
//
// Each test builds a throwaway clone + bare origin so the script's real git
// checks run against a real remote (no mocking of git).
const RELEASE_SH = fileURLToPath(new URL('../release.sh', import.meta.url));
const VERSION = '1.2.3';
const NEXT_VERSION = '1.2.4'; // what a default (patch) bump of VERSION yields

// Module-scoped so runRelease (below) can default RELEASE_CONTAINER_MARKERS to a
// path under it; reassigned per-test in beforeEach.
let root;

function git(cwd, ...args) {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout.trim();
}

function runRelease(cwd, args = [], envOverrides = {}) {
    return spawnSync('bash', [join(cwd, 'release.sh'), ...args], {
        cwd,
        encoding: 'utf8',
        // This suite RUNS INSIDE THE DEV CONTAINER, where release.sh's container
        // refusal would fire and fail every test. Point the marker check at a
        // path that does not exist by default so the refusal stays dormant; the
        // dedicated test overrides it to prove the refusal works.
        env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            RELEASE_CONTAINER_MARKERS: join(root, 'no-such-marker'),
            ...envOverrides,
        },
    });
}

describe('release.sh preflight', () => {
    let origin, clone;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'seeker-release-'));
        origin = join(root, 'origin.git');
        clone = join(root, 'clone');
        git(root, 'init', '--bare', '-b', 'main', origin);
        git(root, 'clone', '-q', origin, clone);
        git(clone, 'config', 'user.email', 'test@example.com');
        git(clone, 'config', 'user.name', 'test');
        cpSync(RELEASE_SH, join(clone, 'release.sh'));
        // No-op npm scripts + an empty lockfile so `npm ci`/typecheck/test/build/
        // test:e2e:retrieval succeed and the script can be driven all the way through bump +
        // push. The e2e gate's Chromium precheck is skipped here because this
        // stub clone has no bench/harness tree (see release.sh verify_basics).
        writeFileSync(join(clone, 'package.json'), JSON.stringify({
            name: 'x',
            version: VERSION,
            scripts: { typecheck: 'true', test: 'true', build: 'true', 'test:e2e:retrieval': 'true', 'test:e2e:obsidian': 'true' },
        }));
        writeFileSync(join(clone, 'package-lock.json'), JSON.stringify({
            name: 'x',
            version: VERSION,
            lockfileVersion: 3,
            packages: { '': { name: 'x', version: VERSION } },
        }));
        // Bare tags (no "v" prefix), same as the real repo's .npmrc.
        writeFileSync(join(clone, '.npmrc'), 'tag-version-prefix=""\n');
        git(clone, 'add', '.');
        git(clone, 'commit', '-q', '-m', VERSION);
        git(clone, 'tag', '-a', VERSION, '-m', VERSION);
        git(clone, 'push', '-q', 'origin', 'main');
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('refuses when the current version tag exists locally but was never pushed', () => {
        const res = runRelease(clone);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(`tag [${VERSION}]`);
        expect(res.stderr).toContain(`git push origin ${VERSION}`);
    });

    it('refuses to run inside a container (exit non-zero, nothing done)', () => {
        // A real container marker file: point the check at it and the refusal
        // must fire before ANY git work, so no NEXT_VERSION tag is ever created.
        const marker = join(root, 'containerenv');
        writeFileSync(marker, '');
        const res = runRelease(clone, [], { RELEASE_CONTAINER_MARKERS: marker });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('inside a container');
        expect(git(clone, 'tag', '-l').split('\n')).not.toContain(NEXT_VERSION);
        expect(git(origin, 'tag', '-l').split('\n')).not.toContain(NEXT_VERSION);

        // The refusal comes AFTER parse_args, so --help still works in-container.
        const help = runRelease(clone, ['--help'], { RELEASE_CONTAINER_MARKERS: marker });
        expect(help.status, help.stderr).toBe(0);
        expect(help.stdout).toContain('Usage:');
    });

    describe('once the current version tag is on origin', () => {
        beforeEach(() => git(clone, 'push', '-q', 'origin', VERSION));

        it('pushes the new version commit AND its tag to origin by default', () => {
            const res = runRelease(clone);
            expect(res.status, res.stderr).toBe(0);
            const originTags = git(origin, 'tag', '-l');
            expect(originTags.split('\n')).toContain(NEXT_VERSION);
            expect(git(origin, 'rev-parse', 'main')).toBe(git(clone, 'rev-parse', 'main'));
        });

        it('with --no-push tags locally and leaves origin untouched', () => {
            const res = runRelease(clone, ['--no-push']);
            expect(res.status, res.stderr).toBe(0);
            expect(git(clone, 'tag', '-l').split('\n')).toContain(NEXT_VERSION);
            expect(git(origin, 'tag', '-l').split('\n')).not.toContain(NEXT_VERSION);
            expect(res.stdout).toContain(`git push --atomic origin main ${NEXT_VERSION}`);
        });
    });
});
