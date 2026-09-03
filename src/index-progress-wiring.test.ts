// Cross-module wiring: the REAL SearchOrchestrator emits structured index-progress
// events (index-progress.ts) through a full pass on the tier-2 harness. Pins the
// per-type (notes vs images) totals + counts and the ocr-before-embed ordering that
// no unit test on the pure emitter can see. Boot pattern copied from
// image-indexing.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { Scenario, fakeOcrEngine, encodeImage } from './test-harness/scenario';
import type { IndexProgressEvent } from './index-progress';

const NOTE_BODY = 'the quarterly product roadmap lists the milestones for shipping the search feature';

describe('index-progress wiring (SearchOrchestrator → IndexProgressEvent)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    // Boot, subscribe, run a cold build; return every event in emission order.
    const runAndCollect = async (opts: { images?: boolean } = {}): Promise<{ events: IndexProgressEvent[]; s: Scenario }> => {
        const s = new Scenario();
        await s.boot(
            opts.images ? { indexImages: true, sidecarEnabled: false } : {},
            opts.images ? { indexDir: 'idx', ocrEngine: fakeOcrEngine() } : {},
        );
        active = s;
        const events: IndexProgressEvent[] = [];
        s.orch.onIndexProgress(e => events.push(e));
        s.vault.write('alpha.md', NOTE_BODY, 1000);
        s.vault.write('bravo.md', NOTE_BODY, 1100);
        s.vault.write('charlie.md', NOTE_BODY, 1200);
        if (opts.images) {
            s.vault.writeImage('one.png', encodeImage('screenshot text alpha bravo charlie'), 1300);
            s.vault.writeImage('two.png', encodeImage('screenshot text delta echo foxtrot'), 1400);
            await s.orch.ocrPrepass(s.vault.getFiles());
        }
        await s.coldStart();
        return { events, s };
    };

    const embeds = (events: IndexProgressEvent[]) => events.filter(e => e.phase === 'embed');

    it('the first embed event reports notes.done === 0', async () => {
        // GIVEN a cold build over three notes
        const { events } = await runAndCollect();
        // WHEN / THEN the pass-start event has committed nothing yet
        expect(embeds(events)[0].notes.done).toBe(0);
    });

    it('the first embed event reports the full note total', async () => {
        // GIVEN a cold build over three notes
        const { events } = await runAndCollect();
        // WHEN / THEN the totals are known from the very first event
        expect(embeds(events)[0].notes.total).toBe(3);
    });

    it('the last embed event has all notes committed (done === total)', async () => {
        // GIVEN a cold build over three notes
        const { events } = await runAndCollect();
        // WHEN / THEN the final event shows every note committed
        const last = embeds(events).at(-1)!;
        expect(last.notes.done).toBe(last.notes.total);
    });

    it('the last embed event reports the image total with images enabled', async () => {
        // GIVEN a cold build over three notes and two images (OCR pre-passed)
        const { events } = await runAndCollect({ images: true });
        // WHEN / THEN the final event carries the two-image total
        expect(embeds(events).at(-1)!.images.total).toBe(2);
    });

    it('emits an ocr event carrying the image total before the first embed event', async () => {
        // GIVEN a cold build with images enabled
        const { events } = await runAndCollect({ images: true });
        // WHEN we split the stream at the first embed event
        const firstEmbedIdx = events.findIndex(e => e.phase === 'embed');
        // THEN an ocr event with the image count preceded it
        expect(events.slice(0, firstEmbedIdx).some(e => e.phase === 'ocr' && e.images.total === 2)).toBe(true);
    });
});
