// Opening a `.canvas` search result: guaranteed open, best-effort zoom-to-node.
// Plan of record: docs/canvas-search-plan.md §3b + §6 R1/R6.
//
// Only opening the canvas FILE is public API (`leaf.openFile`; `.canvas` is a
// core-registered extension). Focusing one node relies on undocumented
// CanvasView internals — `view.canvas.nodes.get(id)`, `canvas.selectOnly(node)`,
// `canvas.zoomToSelection()` — the same surface every canvas plugin in the
// ecosystem (Advanced Canvas, Enhanced Canvas) leans on. Because it is
// undocumented, this module treats it as hostile: every internal is
// feature-detected, every call is inside try/catch, and the WORST outcome is the
// user landing on the opened canvas (never a throw past the click handler, never
// a wrong node). The node id comes from `canvas_node_id`, stored on the chunk at
// index time (R1) — nothing is re-derived at click time.
//
// Extracted from search-modal.ts so the branch can be unit-tested with a fake
// leaf; the modal owns leaf selection + modal focus/close semantics.

import type { TFile, WorkspaceLeaf } from 'obsidian';

// Where the user actually landed. Diagnostic + test surface; the modal treats
// every outcome the same (canvas is open either way).
export type CanvasOpenOutcome =
    | 'opened'         // no node id on the chunk (map chunk / ambiguous card) → open only
    | 'focused'        // node selected + zoomed
    | 'node-missing'   // canvas edited since indexing, or nodes never became ready
    | 'no-api'         // the internals are not there (Obsidian changed them / non-canvas view)
    | 'focus-failed';  // an internal threw; user left on the opened canvas

// The slice of the undocumented CanvasView surface we touch. `unknown`-typed on
// purpose: nothing here is a contract, and the detection below is the only
// place allowed to assume any shape.
interface CanvasInternals {
    nodes: { get(id: string): unknown };
    selectOnly(node: unknown): void;
    zoomToSelection(): void;
}

export interface CanvasOpenDeps {
    // ONE diagnostics line per failed focus (logger.appendError in production).
    reportFailure: (context: string, e: unknown) => void;
    // Popout-window convention: `activeWindow.requestAnimationFrame`, injected
    // so tests run the retry synchronously.
    nextFrame: (cb: () => void) => void;
}

// A leaf.openFile result whose nodes are not ready yet is retried exactly once
// on the next animation frame (R6: one rAF is the ceiling, no polling).
const NODE_READY_RETRIES = 1;

export class CanvasResultOpener {
    constructor(private readonly deps: CanvasOpenDeps) {}

    // Opens `file` in `leaf` (the guaranteed step) and then, only when the chunk
    // names a node, tries to select + zoom to it. `active` follows the modal's
    // open semantics (background alt-open keeps the modal focused).
    async open(
        leaf: WorkspaceLeaf,
        file: TFile,
        nodeId: string | undefined,
        active: boolean,
    ): Promise<CanvasOpenOutcome> {
        // `eState.match.nodeId` is a speculative hint: if core's canvas view ever
        // honours it (Advanced Canvas's canvas-patcher suggests it may), the view
        // lands on the node by itself and the explicit focus below is a no-op
        // re-selection of the same node. Unverified in a real Obsidian at the
        // time of writing — see the ticket; harmless when ignored.
        const eState = nodeId ? { match: { nodeId } } : undefined;
        await leaf.openFile(file, { active, eState });
        if (!nodeId) return 'opened';
        return this.focusNode(leaf, nodeId, NODE_READY_RETRIES);
    }

    private focusNode(leaf: WorkspaceLeaf, nodeId: string, retriesLeft: number): Promise<CanvasOpenOutcome> {
        const canvas = detectCanvasInternals(leaf.view);
        if (!canvas) return Promise.resolve('no-api');

        let node: unknown;
        try {
            node = canvas.nodes.get(nodeId);
        } catch (e) {
            return Promise.resolve(this.failed('canvas-node-lookup', e));
        }
        if (node == null) {
            // The view may populate its node map a frame after openFile resolves.
            if (retriesLeft <= 0) return Promise.resolve('node-missing');
            return new Promise(resolve => {
                this.deps.nextFrame(() => resolve(this.focusNode(leaf, nodeId, retriesLeft - 1)));
            });
        }

        try {
            canvas.selectOnly(node);
            canvas.zoomToSelection();
            return Promise.resolve('focused');
        } catch (e) {
            return Promise.resolve(this.failed('canvas-zoom-to-node', e));
        }
    }

    private failed(context: string, e: unknown): CanvasOpenOutcome {
        this.deps.reportFailure(context, e);
        return 'focus-failed';
    }
}

// Feature detection is the ONLY place that assumes the internals' shape.
function detectCanvasInternals(view: unknown): CanvasInternals | null {
    const canvas = (view as { canvas?: unknown } | null | undefined)?.canvas as Partial<CanvasInternals> | undefined;
    if (!canvas || typeof canvas !== 'object') return null;
    if (typeof canvas.nodes?.get !== 'function') return null;
    if (typeof canvas.selectOnly !== 'function') return null;
    if (typeof canvas.zoomToSelection !== 'function') return null;
    return canvas as CanvasInternals;
}
