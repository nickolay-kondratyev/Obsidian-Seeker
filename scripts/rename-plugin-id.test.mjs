import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Guard for the fork: merging upstream Obsidian-Seek reintroduces the `seek`
// namespace (CSS classes, 'seek' literals, SeekSettings). A partial namespace
// silently breaks styling and storage scoping, so the tracked tree must stay
// fully renamed. Fix by running the script without flags.
describe('rename-plugin-id --check', () => {
    it('finds no remaining seek-namespace tokens in tracked files', () => {
        const script = fileURLToPath(new URL('./rename-plugin-id.mjs', import.meta.url));
        const res = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
        expect(res.stdout + res.stderr).toContain('files=[0]');
        expect(res.status).toBe(0);
    });
});
