// Open history — when each vault file was last opened, on any of the user's
// devices (feature ticket nid_8mpjxf78jw4ita3azfwijr4g8_e, "Decisions"). Only the
// LAST open per path is kept; the key is the vault-relative path, the value epoch ms.
//
// Storage: `<sidecar index dir>/opens/opens.<producerId>.jsonl`, one file per
// producer (device + vault), written ONLY by its owner — so sync can never
// conflict. Rides the sidecar dir like the OCR cache (ocr-cache.ts) to inherit its
// sync decisions, NOT its enablement: written with `sidecarEnabled` off too. Not in
// IndexedDB (a full reindex wipes it; iOS evicts it) nor data.json (one shared
// file sync clobbers).
//
// Why no existing sidecar code touches it: every sidecar lister/reaper/signature
// reads only the index dir's TOP-LEVEL files whose names match the strict
// SHARD/JSONL/META/BM25 patterns (sidecar.ts); this file lives in a sub-folder and
// its base name `opens.*.jsonl` matches none of them. sweepOrphanTmpFiles does
// recurse, but only acts on a `.tmp` whose real name matches those patterns — so
// this store recovers its own temp file (see load()).
//
// Record (one JSON object per line):
//   {"path":"a.md","ms":1700000000000}                 — opened
//   {"path":"b.md","ms":1700000000000,"from":"a.md"}  — rename carried a's time to b
// Lines replay IN ORDER (a later line for a path overrides an earlier one); a torn
// or unparseable line is skipped. The file is rewritten to one line per path at
// startup (once the vault file list is complete, dropping paths no longer in the
// vault; skipped when already compact) and after REWRITE_AFTER_APPENDED_LINES
// appends, so its size is bounded by the number of files ever opened, not the
// number of opens.
//
// Cross-device (ticket nid_5icqphif0kxwg5pgygti668d8_e): the store also READS every
// peer producer's file in the same folder (never writes, rewrites or deletes one)
// and lastOpenedMs answers the newest time across its own and the peers' records,
// compared as recorded (no clock-skew correction). Peers are re-checked on each
// refresh() by size+mtime, so an unchanged folder costs a list + stats, no reads.
// The own file keeps only OWN records, except a rename carry-over: a peer-only time
// renamed here is written to the own file under the new path.
//
// Writes are batched behind FLUSH_BATCH_WINDOW_MS (iCloud re-uploads the whole
// file on every change) and flushed best-effort on background/unload. A failed
// append keeps its lines in memory and retries on the next window.
//
// What counts as an "open": main.ts stamps on `workspace.on('file-open')` with a
// non-null file. VERIFIED 2026-11-20 in the real-Obsidian harness (Obsidian
// 1.12.7, one-off probe spec, ticket nid_aqto46kr20cwc4w3ry61b851l_e): a hover
// preview (page-preview popover rendered) fired NO file-open; after a relaunch with
// three restored tabs, only the restored FOREGROUND tab got a fresh stamp, the two
// background tabs did not. The foreground tab counting is intended (the user is
// looking at it) — deliberately not suppressed. Re-check if Obsidian changes how
// it defers background tabs.
//
// Obsidian-free: file I/O goes through the structural OpenHistoryAdapter
// (Obsidian's DataAdapter satisfies it); clock and timers are injected, so the
// store is unit-testable without real timers.

import type { DataAdapter } from 'obsidian';
import {
    appendJsonlLine,
    ensureDir,
    isSameDeviceOtherVaultProducer,
    writeTextAtomic,
    type SidecarSelf,
    type TextFileAdapter,
} from './sidecar';

// Opens are batched for this long before one append (iCloud re-uploads the whole
// file per change; a few seconds keeps a burst of tab switches to one write).
export const FLUSH_BATCH_WINDOW_MS = 3000;
// Rewrite the file to one line per path once this many lines were appended since
// the last rewrite (a desktop session can run for weeks); duplicate/invalid lines
// found at load count toward it too. ~60 B/line → ~30 KB cap
// of redundant lines between rewrites.
export const REWRITE_AFTER_APPENDED_LINES = 500;

export const OPEN_HISTORY_SUBDIR = 'opens';
// Producer ids are alnum + dash (logger.ts producerIdFor), so this strict pattern
// excludes sync conflict copies ("opens.x 2.jsonl") and `.tmp` files — so a peer's
// in-flight temp file is never read. Group 1 is the owning producer id.
export const OPEN_HISTORY_FILE_RE = /^opens\.([A-Za-z0-9-]+)\.jsonl$/;

export function openHistoryPathFor(indexDir: string, producerId: string): string {
    return `${indexDir}/${OPEN_HISTORY_SUBDIR}/opens.${producerId}.jsonl`;
}

// `list` + `stat` serve the peer scan (Obsidian's DataAdapter satisfies all of it).
export type OpenHistoryAdapter = TextFileAdapter & Pick<DataAdapter, 'list' | 'stat'>;

// Popout-window convention: main.ts passes window.setTimeout/clearTimeout.
export interface OpenHistoryTimers {
    setTimeout(fn: () => void, ms: number): number;
    clearTimeout(handle: number): void;
}

export interface OpenHistoryDeps {
    now(): number;
    timers: OpenHistoryTimers;
    // Structured error sink (main.ts: logger.appendError). Never given note paths.
    onError(context: string, e: unknown): void;
}

// True when the vault-relative path is a file still in the vault. Only valid once
// the vault file list is complete (after workspace.onLayoutReady).
export type LivePathOracle = (path: string) => boolean;

interface OpenLine { path: string; ms: number; from?: string }

function lineFor(rec: OpenLine): string {
    return JSON.stringify(rec) + '\n';
}

function parseLine(raw: string): OpenLine | null {
    if (raw.trim() === '') return null;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return null; }
    if (typeof v !== 'object' || v === null) return null;
    const { path, ms, from } = v as Record<string, unknown>;
    if (typeof path !== 'string' || path === '' || typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    if (from !== undefined && typeof from !== 'string') return null;
    return from === undefined ? { path, ms } : { path, ms, from };
}

// Replay one open-history file's text into path → last-opened ms. Torn/invalid
// lines are skipped (the rest of the file still counts).
export function parseOpenHistory(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const raw of text.split('\n')) {
        const rec = parseLine(raw);
        if (!rec) continue;
        if (rec.from !== undefined) out.delete(rec.from);
        out.set(rec.path, rec.ms);
    }
    return out;
}

// The read side the search path depends on (SearchOrchestrator). Both members
// are a contract the `opened-after:` filter and the cross-device merge rely on.
export interface LastOpenedLookup {
    // Synchronous O(1) — called once per chunk in the search hot path.
    lastOpenedMs(path: string): number | undefined;
    // Resolves once the in-memory view is current; a search awaits it before reading.
    refresh(): Promise<void>;
}

// One peer producer's file as last read: `signature` is its size+mtime, so an
// unchanged file is never re-read.
interface PeerFile { signature: string; times: Map<string, number> }

interface EntryMove { from: string; to: string; ms: number }

type PreLoadOp =
    | { kind: 'open'; path: string; ms: number }
    | { kind: 'rename'; from: string; to: string };

export class OpenHistoryStore implements LastOpenedLookup {
    private readonly filePath: string;
    private readonly tmpPath: string;
    private readonly dir: string;
    // THIS producer's records only — what the own file holds (rewrite source).
    private lastOpened = new Map<string, number>();
    // Peer file path → its parsed records, and their per-path max (rebuilt when
    // any peer file changes) so lastOpenedMs stays O(1).
    private peers = new Map<string, PeerFile>();
    private peerLastOpened = new Map<string, number>();
    // Serializes peer scans (independent of `chain`: a scan never touches the own file).
    private peerChain: Promise<void> = Promise.resolve();

    private loaded = false;
    private loadPromise: Promise<void> | null = null;
    // Ops that arrived before load() finished: applied to the in-memory view at
    // once (best effort), and replayed over the loaded file so none is lost.
    private preLoadOps: PreLoadOp[] = [];
    private pendingLines: string[] = [];
    // Upper bound on the file's lines a rewrite would drop: at load, the lines
    // beyond one per loaded path; then every appended line counts (conservatively,
    // even a first open of a new path). Zero = the file is already one line per
    // path, so the startup rewrite can skip a no-op write (and its sync upload).
    private redundantLines = 0;
    // The file ends in a torn line (crash mid-append): prefix the next append with
    // '\n' so the new record does not fuse into the torn one.
    private needsLeadingNewline = false;
    // The on-disk file is missing data the in-memory view has (a restored `.tmp`
    // that could not be renamed back, or a failed rewrite): the next flush must
    // rewrite the whole file, never append to a fresh one.
    private mustRewrite = false;
    // The file exists but could not be read: a rewrite would replace history we
    // never saw, so this session only appends.
    private rewriteBlocked = false;
    private isLive: LivePathOracle | null = null;
    private flushTimer: number | null = null;
    private disposed = false;
    // Serializes load / append / rewrite so a rewrite never races an append.
    private chain: Promise<void> = Promise.resolve();

    constructor(
        private readonly adapter: OpenHistoryAdapter,
        indexDir: string,
        // The full self (not just producerId): the cross-device reader needs the
        // device prefix to skip this device's other vaults.
        readonly self: SidecarSelf,
        private readonly deps: OpenHistoryDeps,
    ) {
        this.dir = `${indexDir}/${OPEN_HISTORY_SUBDIR}`;
        this.filePath = openHistoryPathFor(indexDir, self.producerId);
        this.tmpPath = `${this.filePath}.tmp`;
    }

    // Synchronous O(1) lookup — called once per chunk in the search hot path.
    // Newest of this producer's and every peer's time.
    lastOpenedMs(path: string): number | undefined {
        const own = this.lastOpened.get(path);
        const peer = this.peerLastOpened.get(path);
        if (peer === undefined) return own;
        if (own === undefined) return peer;
        return Math.max(own, peer);
    }

    // Resolves once the in-memory view is current: the own file is loaded (once)
    // and peer files changed since the last call are re-read. A search awaits this
    // before reading lastOpenedMs. Never rejects.
    refresh(): Promise<void> {
        return this.ensureLoaded().then(() => this.syncPeers());
    }

    // `path` just became the active file.
    recordOpen(path: string): void {
        const ms = this.deps.now();
        if (!this.loaded) {
            this.lastOpened.set(path, ms);
            this.preLoadOps.push({ kind: 'open', path, ms });
            void this.ensureLoaded();
            return;
        }
        this.applyOpen(path, ms);
        this.scheduleFlush();
    }

    // A file or folder was renamed inside Obsidian. Moves the exact path and every
    // path under `from/` — so a folder event and the per-file events for its
    // children are idempotent in any order (whichever runs second finds nothing
    // left under the old path).
    rename(from: string, to: string): void {
        if (from === to) return;
        if (!this.loaded) {
            this.moveEntries(from, to);
            this.preLoadOps.push({ kind: 'rename', from, to });
            void this.ensureLoaded();
            return;
        }
        for (const m of this.moveEntries(from, to)) this.pendingLines.push(lineFor({ path: m.to, ms: m.ms, from: m.from }));
        this.scheduleFlush();
    }

    // Call once the vault file list is complete (workspace.onLayoutReady). Enables
    // dropping paths no longer in the vault, and runs the startup rewrite.
    enablePruning(isLive: LivePathOracle): Promise<void> {
        this.isLive = isLive;
        void this.ensureLoaded();
        return this.enqueue(() => this.rewrite());
    }

    // Write pending stamps now (background / unload). Best-effort: the caller
    // cannot await it when the OS is about to kill the app.
    flushNow(): Promise<void> {
        this.clearFlushTimer();
        return this.enqueue(() => this.flushPending());
    }

    // Plugin unload: flush what is pending and arm no further timers.
    dispose(): Promise<void> {
        const flushed = this.flushNow();
        this.disposed = true;
        return flushed;
    }

    private ensureLoaded(): Promise<void> {
        this.loadPromise ??= this.enqueue(() => this.load());
        return this.loadPromise;
    }

    private syncPeers(): Promise<void> {
        const run = this.peerChain.then(() => this.scanPeers()).catch(e => this.deps.onError('open-history-peers', e));
        this.peerChain = run;
        return run;
    }

    // Peer producers this store reads: every `opens.<producerId>.jsonl` except its
    // own and this device's OTHER vaults (isSameDeviceOtherVaultProducer, the shared
    // reader rule). Other devices are read whatever their vault key — two devices of
    // one synced vault have different vault keys. KNOWN CEILING (accepted by the
    // human): two different vaults sharing one plugins folder that both hold the
    // same vault-relative path — an open on another device in one counts for the
    // other. Separating them needs a cross-device vault identity, which does not exist.
    private isReadablePeerFile(path: string): boolean {
        const m = OPEN_HISTORY_FILE_RE.exec(path.slice(path.lastIndexOf('/') + 1));
        if (!m) return false;
        const producerId = m[1];
        return producerId !== this.self.producerId && !isSameDeviceOtherVaultProducer(producerId, this.self);
    }

    // Re-read only the peer files whose size+mtime changed; drop vanished ones. A
    // failed list/stat/read keeps that file's previous records (retried next call).
    private async scanPeers(): Promise<void> {
        let files: string[];
        try {
            files = (await this.adapter.list(this.dir)).files;
        } catch {
            return; // folder not created yet (no device has opened anything)
        }
        const present = new Set<string>();
        let changed = false;
        for (const path of files) {
            if (!this.isReadablePeerFile(path)) continue;
            const st = await this.adapter.stat(path).catch(() => undefined);
            if (st === null) continue; // vanished between list and stat
            present.add(path);
            if (st === undefined) continue;
            const signature = `${st.size}:${st.mtime}`;
            if (this.peers.get(path)?.signature === signature) continue;
            let text: string;
            try {
                text = await this.adapter.read(path);
            } catch (e) {
                this.deps.onError('open-history-peer-read', e);
                continue;
            }
            this.peers.set(path, { signature, times: parseOpenHistory(text) });
            changed = true;
        }
        for (const path of [...this.peers.keys()]) {
            if (!present.has(path)) { this.peers.delete(path); changed = true; }
        }
        if (changed) this.rebuildPeerLastOpened();
    }

    // O(all peer records) per changed scan — fine at "files ever opened × devices"
    // scale; per-file incremental max is the upgrade if that ever changes.
    private rebuildPeerLastOpened(): void {
        const merged = new Map<string, number>();
        for (const peer of this.peers.values()) {
            for (const [path, ms] of peer.times) {
                const prev = merged.get(path);
                if (prev === undefined || ms > prev) merged.set(path, ms);
            }
        }
        this.peerLastOpened = merged;
    }

    private enqueue(fn: () => Promise<void>): Promise<void> {
        const run = this.chain.then(fn).catch(e => this.deps.onError('open-history', e));
        this.chain = run;
        return run;
    }

    private scheduleFlush(): void {
        if (this.disposed || this.flushTimer !== null) return;
        // A fixed batch window (not reset per open) so a steady stream of tab
        // switches still flushes every few seconds.
        this.flushTimer = this.deps.timers.setTimeout(() => {
            this.flushTimer = null;
            void this.enqueue(() => this.flushPending());
        }, FLUSH_BATCH_WINDOW_MS);
    }

    private clearFlushTimer(): void {
        if (this.flushTimer === null) return;
        this.deps.timers.clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    private applyOpen(path: string, ms: number): void {
        this.lastOpened.set(path, ms);
        this.pendingLines.push(lineFor({ path, ms }));
    }

    // Moves own entries at/under `from` carrying the MERGED time, and carries a
    // peer-only time into the own records (the one way a peer time enters the own
    // file) unless the new path already shows it or newer — so a repeated event
    // (folder + per-file) never regresses a time. Peers keep the old path (never
    // written by this device).
    // O(own + peer entries) scan per rename — fine at "files ever opened" scale and
    // renames are rare; a path trie is the upgrade if that ever changes.
    private moveEntries(from: string, to: string): EntryMove[] {
        const prefix = `${from}/`;
        const isUnder = (path: string) => path === from || path.startsWith(prefix);
        const targetOf = (path: string) => (path === from ? to : to + path.slice(from.length));
        const moves: EntryMove[] = [];
        for (const [path, ms] of this.lastOpened) {
            if (isUnder(path)) moves.push({ from: path, to: targetOf(path), ms: Math.max(ms, this.peerLastOpened.get(path) ?? ms) });
        }
        for (const [path, ms] of this.peerLastOpened) {
            if (!isUnder(path) || this.lastOpened.has(path)) continue;
            const target = targetOf(path);
            if (ms > (this.lastOpenedMs(target) ?? -Infinity)) moves.push({ from: path, to: target, ms });
        }
        for (const m of moves) this.lastOpened.delete(m.from);
        for (const m of moves) this.lastOpened.set(m.to, m.ms);
        return moves;
    }

    private async load(): Promise<void> {
        let text = '';
        try {
            text = await this.readPersisted();
        } catch (e) {
            this.rewriteBlocked = true;
            this.deps.onError('open-history-load', e);
        }
        // Peers first, so a pre-load rename replayed below carries the merged time.
        // fromDisk is swapped in only after this await: an op arriving meanwhile
        // lands in the pre-load view and in preLoadOps, and replays exactly once.
        await this.syncPeers();
        const fromDisk = parseOpenHistory(text);
        this.redundantLines = text.split('\n').filter(l => l !== '').length - fromDisk.size;
        this.needsLeadingNewline = text !== '' && !text.endsWith('\n');
        this.lastOpened = fromDisk;
        this.loaded = true;
        const ops = this.preLoadOps;
        this.preLoadOps = [];
        for (const op of ops) {
            if (op.kind === 'open') this.applyOpen(op.path, op.ms);
            else for (const m of this.moveEntries(op.from, op.to)) this.pendingLines.push(lineFor({ path: m.to, ms: m.ms, from: m.from }));
        }
        if (this.pendingLines.length > 0 || this.mustRewrite) this.scheduleFlush();
    }

    // The real file wins when present (a leftover `.tmp` beside it is a rewrite
    // that never swapped in → discarded). Only the `.tmp` present = a rewrite
    // crashed between iOS's remove-then-rename → restore it.
    private async readPersisted(): Promise<string> {
        const hasFile = await this.adapter.exists(this.filePath).catch(() => false);
        const hasTmp = await this.adapter.exists(this.tmpPath).catch(() => false);
        if (hasFile) {
            if (hasTmp) await this.adapter.remove(this.tmpPath).catch(() => {});
            return this.adapter.read(this.filePath);
        }
        if (!hasTmp) return '';
        const text = await this.adapter.read(this.tmpPath);
        try {
            await this.adapter.rename(this.tmpPath, this.filePath);
        } catch {
            this.mustRewrite = true;
        }
        return text;
    }

    private async flushPending(): Promise<void> {
        if (!this.loaded) return;
        if (this.mustRewrite) return this.rewrite();
        if (this.pendingLines.length === 0) return;
        const batch = this.pendingLines;
        this.pendingLines = [];
        const text = (this.needsLeadingNewline ? '\n' : '') + batch.join('');
        try {
            await ensureDir(this.adapter, this.dir);
            await appendJsonlLine(this.adapter, this.filePath, text);
        } catch (e) {
            this.pendingLines = batch.concat(this.pendingLines);
            this.deps.onError('open-history-append', e);
            this.scheduleFlush();
            return;
        }
        this.needsLeadingNewline = false;
        this.redundantLines += batch.length;
        if (this.redundantLines >= REWRITE_AFTER_APPENDED_LINES) await this.rewrite();
    }

    // Rewrite the file to one line per path from the OWN in-memory view (which
    // already holds every pending stamp; peer records are never copied in), pruning paths no longer in the vault once the
    // vault file list is known. Skipped when it would write the same bytes.
    private async rewrite(): Promise<void> {
        if (!this.loaded || this.rewriteBlocked) return;
        let pruned = 0;
        if (this.isLive) {
            for (const path of [...this.lastOpened.keys()]) if (!this.isLive(path)) { this.lastOpened.delete(path); pruned++; }
        }
        const fileAlreadyCompact = pruned === 0 && this.redundantLines === 0 && this.pendingLines.length === 0
            && !this.mustRewrite && !this.needsLeadingNewline;
        if (fileAlreadyCompact) return;
        const batch = this.pendingLines;
        this.pendingLines = [];
        let text = '';
        for (const [path, ms] of this.lastOpened) text += lineFor({ path, ms });
        try {
            await ensureDir(this.adapter, this.dir);
            await writeTextAtomic(this.adapter, this.filePath, text);
        } catch (e) {
            // The atomic write may have removed the real file (iOS fallback): never
            // append to a fresh file next time, rewrite again.
            this.mustRewrite = true;
            this.pendingLines = batch.concat(this.pendingLines);
            this.deps.onError('open-history-rewrite', e);
            this.scheduleFlush();
            return;
        }
        this.mustRewrite = false;
        this.needsLeadingNewline = false;
        this.redundantLines = 0;
    }
}
