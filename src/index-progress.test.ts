// Unit tests for the pure index-progress emitter + label (index-progress.ts).
import { describe, it, expect, vi } from 'vitest';
import { IndexProgressEmitter, progressLabel, type IndexProgressEvent } from './index-progress';

const embedEvent = (over: Partial<IndexProgressEvent> = {}): IndexProgressEvent => ({
    phase: 'embed', notes: { done: 1, total: 2 }, images: { done: 0, total: 0 }, paused: false, ...over,
});

describe('IndexProgressEmitter', () => {
    it('delivers an emitted event to a subscriber', () => {
        // GIVEN a subscriber
        const emitter = new IndexProgressEmitter();
        const seen: IndexProgressEvent[] = [];
        emitter.subscribe(e => seen.push(e));
        // WHEN an event is emitted
        const event = embedEvent();
        emitter.emit(event);
        // THEN the subscriber received it
        expect(seen).toEqual([event]);
    });

    it('stops delivering after unsubscribe', () => {
        // GIVEN a subscriber that has unsubscribed
        const emitter = new IndexProgressEmitter();
        const seen: IndexProgressEvent[] = [];
        const unsub = emitter.subscribe(e => seen.push(e));
        unsub();
        // WHEN an event is emitted
        emitter.emit(embedEvent());
        // THEN the former subscriber received nothing
        expect(seen).toEqual([]);
    });

    it('still calls a later listener when an earlier one throws', () => {
        // GIVEN a throwing listener registered before a healthy one
        const emitter = new IndexProgressEmitter(() => {});   // swallow the reported error
        const seen: IndexProgressEvent[] = [];
        emitter.subscribe(() => { throw new Error('boom'); });
        emitter.subscribe(e => seen.push(e));
        // WHEN an event is emitted
        const event = embedEvent();
        emitter.emit(event);
        // THEN the healthy listener was still called
        expect(seen).toEqual([event]);
    });

    it('routes a throwing listener to onListenerError', () => {
        // GIVEN an emitter with an error sink and a throwing listener
        const onError = vi.fn();
        const emitter = new IndexProgressEmitter(onError);
        emitter.subscribe(() => { throw new Error('boom'); });
        // WHEN an event is emitted
        emitter.emit(embedEvent());
        // THEN the error was reported once
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('progressLabel', () => {
    it('labels a notes-only embed pass', () => {
        // GIVEN an embed event with no images
        const e = embedEvent({ notes: { done: 80, total: 90 }, images: { done: 0, total: 0 } });
        // WHEN / THEN
        expect(progressLabel(e)).toBe('80 / 90 notes');
    });

    it('labels an embed pass that also has images', () => {
        // GIVEN an embed event with images
        const e = embedEvent({ notes: { done: 80, total: 90 }, images: { done: 10, total: 30 } });
        // WHEN / THEN
        expect(progressLabel(e)).toBe('80 / 90 notes · 10 / 30 images');
    });

    it('labels an ocr pre-pass event', () => {
        // GIVEN an ocr event
        const e: IndexProgressEvent = { phase: 'ocr', notes: { done: 0, total: 0 }, images: { done: 3, total: 12 }, paused: false };
        // WHEN / THEN
        expect(progressLabel(e)).toBe('OCR 3 / 12 images');
    });
});
