import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Obsidian's release check rebuilds the plugin from the tagged source and fails
// if the bytes differ from the published main.js ("build output does not match
// the released main.js artifact"). The bundle must therefore be a pure function
// of the committed source: two production builds of the same commit MUST emit an
// identical main.js. The classic offender was esbuild.config.mjs stamping a
// wall-clock `new Date()` into __BUILD_TS__ — this guards against reintroducing
// any such non-determinism.
describe('production build is reproducible', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const config = fileURLToPath(new URL('../esbuild.config.mjs', import.meta.url));
    const mainJs = fileURLToPath(new URL('../main.js', import.meta.url));

    const build = () => {
        const res = spawnSync(process.execPath, [config, 'production'], {
            cwd: root,
            encoding: 'utf8',
        });
        expect(res.status, res.stderr).toBe(0);
        return readFileSync(mainJs, 'utf8');
    };

    it('emits byte-identical main.js across two builds', () => {
        expect(build()).toBe(build());
    });
});
