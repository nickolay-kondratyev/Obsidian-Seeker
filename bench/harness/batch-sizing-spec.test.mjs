import { describe, it, expect } from 'vitest';
import { BatchSizingSpec } from './batch-sizing-spec.mjs';

describe('BatchSizingSpec.parse', () => {
    it('GIVEN "2048/16" THEN budget 2048, max 16', () => {
        expect(BatchSizingSpec.parse('2048/16')).toEqual({ budgetTokens: 2048, maxBatch: 16 });
    });
    it('tolerates surrounding whitespace', () => {
        expect(BatchSizingSpec.parse(' 512 / 8 ')).toEqual({ budgetTokens: 512, maxBatch: 8 });
    });
    it.each(['2048', '2048:16', 'a/b', '', '0/8', '512/0'])('rejects [%s]', bad => {
        expect(() => BatchSizingSpec.parse(bad)).toThrow(/batch sizing/);
    });
});

describe('BatchSizingSpec.parseList', () => {
    it('keeps the given order', () => {
        expect(BatchSizingSpec.parseList('1024/16, 512/8').map(BatchSizingSpec.format)).toEqual(['1024/16', '512/8']);
    });
    it('rejects a duplicate', () => {
        expect(() => BatchSizingSpec.parseList('512/8,512/8')).toThrow(/twice/);
    });
});

describe('BatchSizingSpec.format', () => {
    it('round-trips parse', () => {
        expect(BatchSizingSpec.format(BatchSizingSpec.parse('4096/32'))).toBe('4096/32');
    });
});
