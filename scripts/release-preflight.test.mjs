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

function git(cwd, ...args) {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout.trim();
}

function runRelease(cwd) {
    return spawnSync('bash', [join(cwd, 'release.sh')], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    });
}

describe('release.sh preflight', () => {
    let root, origin, clone;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'seeker-release-'));
        origin = join(root, 'origin.git');
        clone = join(root, 'clone');
        git(root, 'init', '--bare', '-b', 'main', origin);
        git(root, 'clone', '-q', origin, clone);
        git(clone, 'config', 'user.email', 'test@example.com');
        git(clone, 'config', 'user.name', 'test');
        cpSync(RELEASE_SH, join(clone, 'release.sh'));
        writeFileSync(join(clone, 'package.json'), JSON.stringify({ name: 'x', version: VERSION }));
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

    it('passes once the current version tag is on origin', () => {
        git(clone, 'push', '-q', 'origin', VERSION);
        const res = runRelease(clone);
        // Preflight passed iff the script reached the next step (npm ci), which
        // is expected to fail in this bare fixture — we only assert progression.
        expect(res.stdout).toContain('=== Install (npm ci) ===');
    });
});
