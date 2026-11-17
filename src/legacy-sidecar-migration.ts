// One-time migration off the pre-vault-key sidecar file names (ticket
// nid_tu1d39wbva5bz5h2c2v7bjjlz_e). Builds before the vault key wrote this
// device's sidecar as `*.<deviceId>.*`; the producer id is now
// `<deviceId>-<vaultKey>` (logger.ts producerIdFor), so those files are owned by
// nobody. Left in place they cost every device twice:
//   - they read as ANOTHER producer, so a version-stale single-device vault shows
//     the calm "a newer index is syncing" banner instead of "please reindex";
//   - nothing tombstones or compacts them again, so ids edited after the upgrade
//     stay live there forever and defeat hydrate's no-fresh-ids skip → every peer
//     sidecar change re-chunks the whole vault on every device.
//
// The migration re-publishes this vault's index under the producer id, proves the
// new files hold it, and only then deletes the legacy files. "Needs migration" is
// derived from disk (legacy files present), not a persisted flag, so a crash at
// any point simply reruns it: before the delete the legacy files are intact,
// after it the keyed sidecar is complete. Records already resolvable under the
// producer id are not rewritten, so a rerun (and a boot with nothing to do) is cheap.
//
// The legacy files may be the ONLY copy of vectors this index lost (IndexedDB
// eviction, an interrupted hydrate), so they are deleted only when the index can
// vouch that it holds everything they could restore — see whyIndexCannotVouch.
//
// Shared plugins folder (several vaults → one sidecar dir): every vault on the
// device wrote the same legacy files, so the first vault to migrate deletes them
// for all. Accepted by the ticket; each vault publishes its own keyed sidecar.
//
// WHY-NOT carry the legacy BM25 blob over: in a shared folder it may be another
// vault's corpus. Without it a peer refits BM25 until this device's next full
// reindex republishes one.
//
// Runs under the orchestrator's write lock (SearchOrchestrator.migrateLegacyOwnSidecar),
// which excludes deltas, hydrate and a full reindex; the sidecar's own dir lock
// covers the writers the write lock does not exclude (see the read-back below).
// Model-free and bounded per batch, so it is safe on mobile.

import type { DataAdapter } from 'obsidian';
import type { IndexIdentity } from './identity';
import { identityFromMeta, identityMatches } from './identity';
import type { FileRecord, IndexStore } from './index-store';
import { cheapYield } from './pacer';
import {
    bulkAppend, deviceIdFromArtifactPath, ensureDir, isOffsetInRange, jsonlPathFor, listDeviceShards,
    recordLayout, scanJsonl, withDirLock, type TierBytes,
} from './sidecar';
import { expectationFor, metaAccepts, readDeviceMeta, writeDeviceMeta } from './sidecar-meta';

// Chunks copied from IndexedDB to the sidecar per step. Bounds peak memory to one
// batch of tiers + bodies (a few MB) — the iOS jetsam budget — and puts a yield
// between batches so a large vault never holds the main thread.
const REWRITE_BATCH_CHUNKS = 1000;

// Live notes the index does not fully hold (never indexed, or quarantined) that
// the trust check will re-chunk to prove the legacy files hold nothing for them.
// A healthy index has a handful (notes that synced in while the app was closed);
// an evicted / half-hydrated one has thousands, and
// re-chunking those on every boot is the mobile jank the reconcile gate exists to
// avoid — past the cap the index is treated as unable to vouch.
export const MAX_UNRECORDED_NOTES_TO_PROVE = 50;

const TMP_SUFFIX = '.tmp';

export type LegacySidecarMigrationOutcome =
    | 'no-legacy-files'       // nothing to do — the steady state after the one migration
    | 'index-empty'           // the legacy files may be the only backup
    | 'index-identity-stale'  // index built under another chunker/model — it can't be re-published as current
    | 'index-incomplete'      // the legacy files hold (or may hold) live vectors the index lacks
    | 'own-sidecar-stale'     // this vault's keyed sidecar is from another identity; the next index pass replaces it
    | 'keyed-sidecar-unverified' // the rewrite did not read back complete — legacy files kept
    | 'migrated';

export interface LegacySidecarMigrationResult {
    outcome: LegacySidecarMigrationOutcome;
    chunksRewritten: number;
    legacyFilesDeleted: number;
}

export interface LegacySidecarMigrationInput {
    adapter: DataAdapter;
    indexDir: string;
    legacyProducerId: string; // the bare device id — the name pre-vault-key builds wrote under
    producerId: string;       // `<deviceId>-<vaultKey>` — the name this vault writes under now
    store: IndexStore;
    identity: IndexIdentity;  // the live build identity
    liveNotePaths: string[];  // every live note the index should cover
    // chunk ids of the given live notes; `complete:false` when any could not be read / chunked
    liveIdsOf: (paths: ReadonlySet<string>) => Promise<{ ids: Set<string>; complete: boolean }>;
}

// Every sidecar artifact `producerId` owns in `indexDir` — shards, jsonl, meta,
// BM25 blob, and the `.tmp` of an interrupted atomic write of any of them. Exact
// owner match: `<deviceId>` never matches `<deviceId>-<vaultKey>` or another device.
export async function listProducerSidecarFiles(adapter: DataAdapter, indexDir: string, producerId: string): Promise<string[]> {
    if (!(await adapter.exists(indexDir).catch(() => false))) return [];
    const ls = await adapter.list(indexDir).catch(() => ({ folders: [] as string[], files: [] as string[] }));
    return ls.files.filter(f => {
        const realPath = f.endsWith(TMP_SUFFIX) ? f.slice(0, -TMP_SUFFIX.length) : f;
        return deviceIdFromArtifactPath(realPath) === producerId;
    });
}

// Ids `producerId`'s own files can actually serve: a live jsonl record whose shard
// is on disk and long enough to hold it. A record pointing at a missing/short
// shard does not count, so the rewrite re-appends it instead of trusting it.
async function resolvableIds(adapter: DataAdapter, indexDir: string, producerId: string): Promise<Set<string>> {
    const scan = await scanJsonl(adapter, [jsonlPathFor(indexDir, producerId)]);
    const shardSize = new Map<number, number>();
    for (const s of await listDeviceShards(adapter, indexDir, producerId)) shardSize.set(s.seq, s.size);
    const ids = new Set<string>();
    for (const [id, entry] of scan.map) {
        const size = shardSize.get(entry.seq);
        if (size !== undefined && isOffsetInRange(size, entry.off, recordLayout(entry.dim))) ids.add(id);
    }
    return ids;
}

// Why the legacy files must be kept this boot, or null when the index holds
// everything they could restore. Cheap by construction: the only re-chunk is of
// never-indexed notes, and only when the legacy files hold ids the index lacks.
async function whyIndexCannotVouch(
    input: LegacySidecarMigrationInput, fileRecords: FileRecord[], wanted: ReadonlyMap<string, number>,
): Promise<LegacySidecarMigrationOutcome | null> {
    const { adapter, indexDir, legacyProducerId, store, identity } = input;
    if ((await store.count()).chunks === 0) return 'index-empty';
    if (!identityMatches(identityFromMeta(await store.getMeta()), identity)) return 'index-identity-stale';

    // Measured against `wanted` — exactly what gets re-published — NOT every chunk
    // in IndexedDB: a chunk no file record references (a hydrate killed between its
    // chunk write and its file-record write) is not re-published and the orphan
    // sweep deletes it, so the legacy copy of it must still count as un-held.
    const legacyOnly = new Set<string>();
    for (const id of (await scanJsonl(adapter, [jsonlPathFor(indexDir, legacyProducerId)])).map.keys()) {
        if (!wanted.has(id)) legacyOnly.add(id);
    }
    if (legacyOnly.size === 0) return null;
    // Legacy-only ids are normally dead churn (old versions of edited notes). They
    // can be live only for a note the index does not fully hold: one with no file
    // record, or one whose record is an embed-failure quarantine (it lists only the
    // chunks that embedded — FileRecord.embedFailedChunks). Any other recorded note
    // has every chunk of the version it recorded in `wanted`.
    const fullyRecorded = new Set(fileRecords.filter(r => !r.embedFailedChunks).map(r => r.note_path));
    const unrecorded = input.liveNotePaths.filter(p => !fullyRecorded.has(p));
    if (unrecorded.length === 0) return null;
    if (unrecorded.length > MAX_UNRECORDED_NOTES_TO_PROVE) return 'index-incomplete';
    const live = await input.liveIdsOf(new Set(unrecorded));
    if (!live.complete) return 'index-incomplete';
    for (const id of live.ids) if (legacyOnly.has(id)) return 'index-incomplete';
    return null;
}

// Publish every chunk the index's file records reference under `producerId`,
// skipping what its files already serve. Returns the count written, or null when
// the index turned out to be missing a referenced chunk (it cannot vouch).
async function rewriteUnder(input: LegacySidecarMigrationInput, wanted: ReadonlyMap<string, number>): Promise<number | null> {
    const { adapter, indexDir, producerId, store, identity } = input;
    const served = await resolvableIds(adapter, indexDir, producerId);
    const todo = [...wanted.keys()].filter(id => !served.has(id));
    let written = 0;
    for (let i = 0; i < todo.length; i += REWRITE_BATCH_CHUNKS) {
        const batch = todo.slice(i, i + REWRITE_BATCH_CHUNKS);
        const tiers = await store.getTiersByIds(batch);
        const records: Array<{ id: string; tiers: TierBytes; mtime: number }> = [];
        for (let j = 0; j < batch.length; j++) {
            const t = tiers[j];
            if (!t) return null;
            records.push({ id: batch[j], tiers: { q: t.q.q, s: t.q.s, sign: t.sign }, mtime: wanted.get(batch[j])! });
        }
        await bulkAppend(adapter, indexDir, producerId, records, identity.dim);
        written += records.length;
        await cheapYield();
    }
    return written;
}

export async function migrateLegacySidecar(input: LegacySidecarMigrationInput): Promise<LegacySidecarMigrationResult> {
    const { adapter, indexDir, legacyProducerId, producerId, store, identity } = input;
    const stopped = (outcome: LegacySidecarMigrationOutcome, chunksRewritten = 0): LegacySidecarMigrationResult =>
        ({ outcome, chunksRewritten, legacyFilesDeleted: 0 });

    // A producer id with no vault key IS the legacy name — those files are live, not legacy.
    if (legacyProducerId === producerId) return stopped('no-legacy-files');
    if ((await listProducerSidecarFiles(adapter, indexDir, legacyProducerId)).length === 0) return stopped('no-legacy-files');

    const fileRecords = await store.listFileRecords();
    const wanted = new Map<string, number>(); // chunk id → its note's recorded mtime
    for (const rec of fileRecords) for (const id of rec.chunk_ids) wanted.set(id, rec.mtimeMs);

    const refusal = await whyIndexCannotVouch(input, fileRecords, wanted);
    if (refusal) return stopped(refusal);

    // Meta BEFORE records (the flush path's F8 ordering): a crash in between leaves
    // meta-without-data, which hydrate refuses cleanly, never data nobody can accept.
    const expect = expectationFor(identity);
    const ownMeta = await readDeviceMeta(adapter, indexDir, producerId);
    // Records already under the producer id from another identity/format must not
    // be relabelled current by appending beside them. The flush path owns that wipe
    // (runSidecarFlush, search.ts) and runs it on the next index pass; wait for it.
    if (ownMeta && !metaAccepts(ownMeta, expect)) return stopped('own-sidecar-stale');
    if (!ownMeta) {
        const legacyMeta = await readDeviceMeta(adapter, indexDir, legacyProducerId);
        const indexMeta = await store.getMeta();
        await ensureDir(adapter, indexDir);
        await writeDeviceMeta(adapter, indexDir, {
            ...expect,
            format: identity.sidecarFormat,
            deviceId: producerId,
            lastFullReindex: legacyMeta?.lastFullReindex ?? null,
            bgMean: indexMeta.bgMean,
            bgStd: indexMeta.bgStd,
        });
    }

    const chunksRewritten = await rewriteUnder(input, wanted);
    if (chunksRewritten === null) return stopped('index-incomplete');

    // Read back from disk before anything is deleted: the legacy files go only once
    // the keyed files provably serve the whole index. The read-back and the delete
    // share ONE dir-lock section: own-sidecar compaction / coalesce and the flush's
    // stale wipe take only the dir lock (not the write lock), so none of them can
    // rewrite the keyed files between "verified" and "legacy gone".
    const legacyFilesDeleted = await withDirLock(indexDir, async (): Promise<number | null> => {
        const served = await resolvableIds(adapter, indexDir, producerId);
        for (const id of wanted.keys()) if (!served.has(id)) return null;
        const doomed = await listProducerSidecarFiles(adapter, indexDir, legacyProducerId);
        // The jsonl first: once it is gone no reader resolves a record into a shard
        // that is about to disappear. A failed remove throws — the caller logs it and
        // the next boot finds the leftovers and finishes.
        const legacyJsonl = jsonlPathFor(indexDir, legacyProducerId);
        doomed.sort((a, b) => Number(b === legacyJsonl) - Number(a === legacyJsonl));
        for (const path of doomed) await adapter.remove(path);
        return doomed.length;
    });
    if (legacyFilesDeleted === null) return stopped('keyed-sidecar-unverified', chunksRewritten);
    return { outcome: 'migrated', chunksRewritten, legacyFilesDeleted };
}
