import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

/**
 * Launches a REAL Obsidian (Electron) on a vault assembled per run from the
 * committed e2e corpus + the built plugin, fully sandboxed from any system
 * Obsidian install.
 *
 * Connection: Obsidian is spawned with `--remote-debugging-port=0` and the
 * suite attaches via `chromium.connectOverCDP` to the "DevTools listening on
 * ws://…" endpoint the app prints on stderr.
 * WHY-NOT Playwright's `_electron.launch`: it additionally needs the Electron
 * MAIN process's node inspector (`--inspect=0`), which Obsidian's packaged
 * build ignores (Electron fuses), so `_electron.launch` hangs until timeout —
 * verified against Obsidian 1.12.7. All automation is renderer-level
 * (locators + `window.app`), so browser-level CDP is sufficient.
 *
 * Sandbox mechanism:
 * - `--user-data-dir=<userdata dir>` isolates Obsidian's own config; a
 *   pre-written `obsidian.json` registers the vault with `open: true` so the
 *   app boots straight into it (no vault picker) and `updateDisabled: true`
 *   stops auto-update traffic. The dir is PERSISTENT across runs (see
 *   {@link ObsidianHarness.prepareUserDataDir} for WHY).
 * - `--no-sandbox` on Linux: Electron's SUID chrome-sandbox is unavailable in
 *   most CI containers (electron/electron#42510).
 * - Community plugins are enabled AT RUNTIME via `app.plugins.setEnable(true)`
 *   instead of pre-seeding Chromium's localStorage leveldb (WHY-NOT: seeding
 *   requires a leveldb writer dependency for zero extra value here).
 *
 * Never import from `src/` here or in specs: everything there transitively
 * imports `obsidian`, which is types-only under node.
 */

// `__dirname`, not `import.meta.url`: this repo has no `"type": "module"`, so
// Playwright transpiles specs to CommonJS where `import.meta` is a SyntaxError.
const REPO_ROOT = path.resolve(__dirname, "..");
/**
 * Plugin id from the repo's own manifest — the single source of truth, so this
 * harness is copy-portable across plugin repos.
 */
export const PLUGIN_ID: string = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8"),
).id;

/** Committed corpus the e2e vault is assembled from (same notes as the retrieval gate). */
export const CORPUS_DIR = path.join(REPO_ROOT, "e2e", "datasets", "cqadupstack-android", "corpus");
/** Release artifacts copied into the vault's plugin folder; `main.js` is produced by `npm run build`. */
const PLUGIN_ARTIFACTS = ["main.js", "manifest.json", "styles.css"] as const;

const E2E_TMP_DIR = path.join(REPO_ROOT, ".tmp", "e2e");
const VAULT_DIR = path.join(E2E_TMP_DIR, "vault");
const USER_DATA_DIR = path.join(E2E_TMP_DIR, "userdata");
/** Chromium's IndexedDB store inside the user-data dir (see {@link ObsidianHarness.prepareUserDataDir}). */
const INDEXED_DB_SUBDIR = "IndexedDB";
/** Fixed id for the sandbox `obsidian.json` vault entry (shape: 16 hex chars, like Obsidian's own). */
const E2E_VAULT_ID = "0e2e0e2e0e2e0e2e";

const LAUNCH_TIMEOUT_MS = 60_000;
/** Graceful-shutdown grace before SIGKILL in {@link ObsidianHarness.killAndWaitForExit}. */
const FORCE_KILL_AFTER_MS = 10_000;
const WINDOW_POLL_INTERVAL_MS = 250;
/**
 * Physical Obsidian window size pre-seeded into the sandbox (see
 * {@link ObsidianHarness.prepareUserDataDir}). WHY: headless Obsidian
 * (Docker/CI, `--ozone-platform=headless`) otherwise boots into a tiny ~300×200
 * window; wide panes then overflow off-screen, so nothing is physically
 * clickable and pointer-interaction tests can't reach elements (DOM-assertion
 * tests still pass — they query the DOM directly). A CDP
 * `Emulation.setDeviceMetricsOverride` only resizes the LAYOUT viewport, not the
 * input surface, so real clicks still miss; resizing the actual window is the
 * only fix. Obsidian restores this from `<userdata>/<vaultId>.json` at boot.
 */
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 800;
/** App boot → `layoutReady` covers vault index + workspace restore. */
const WORKSPACE_READY_TIMEOUT_MS = 60_000;
const PLUGIN_READY_TIMEOUT_MS = 30_000;

export class ObsidianHarness {
	private constructor(
		private readonly browser: Browser,
		private readonly obsidianProcess: childProcess.ChildProcess,
		readonly page: Page,
	) {}

	/** Fails fast with an actionable message when the binary env var is absent. */
	static resolveObsidianPath(): string {
		const obsidianPath = process.env["OBSIDIAN_PATH"];
		if (obsidianPath === undefined || obsidianPath === "") {
			throw new Error(
				"OBSIDIAN_PATH is not set. Point it at an Obsidian binary, e.g.\n" +
					"  Linux:  OBSIDIAN_PATH=$(bash scripts/setup-obsidian-bin.sh)\n" +
					"  macOS:  export OBSIDIAN_PATH='/Applications/Obsidian.app/Contents/MacOS/Obsidian'\n" +
					"  Windows: set OBSIDIAN_PATH to Obsidian.exe\n" +
					"Then re-run: npm run test:e2e:obsidian",
			);
		}
		if (!fs.existsSync(obsidianPath)) {
			throw new Error(`OBSIDIAN_PATH does not exist: obsidianPath=[${obsidianPath}]`);
		}
		return obsidianPath;
	}

	/** Fresh launch: assembles a fresh vault, re-seeds the sandbox config, then boots Obsidian. */
	static async launch(): Promise<ObsidianHarness> {
		ObsidianHarness.assembleVault();
		ObsidianHarness.prepareUserDataDir();
		return ObsidianHarness.spawnAndConnect();
	}

	/** Spawns the Obsidian process against the already-prepared dirs and attaches over CDP. */
	private static async spawnAndConnect(): Promise<ObsidianHarness> {
		const executablePath = ObsidianHarness.resolveObsidianPath();
		const obsidianProcess = childProcess.spawn(executablePath, [
			`--user-data-dir=${USER_DATA_DIR}`,
			// Port 0 = OS-assigned; the concrete endpoint is read from stderr.
			"--remote-debugging-port=0",
			...(process.platform === "linux" ? ["--no-sandbox"] : []),
			// Escape hatch for environment-specific Chromium flags (e.g.
			// `--ozone-platform=headless` on display-less CI) without editing the harness.
			// Space-separated flags only — quoting is NOT supported, so no flag values with spaces.
			...(process.env["OBSIDIAN_E2E_EXTRA_ARGS"]?.split(" ").filter((arg) => arg !== "") ?? []),
		]);
		try {
			const cdpEndpoint = await ObsidianHarness.waitForDevtoolsEndpoint(obsidianProcess);
			const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: LAUNCH_TIMEOUT_MS });
			const page = await ObsidianHarness.waitForObsidianWindow(browser);
			await ObsidianHarness.waitForWorkspaceReady(page);
			await ObsidianHarness.enableCommunityPlugins(page);
			return new ObsidianHarness(browser, obsidianProcess, page);
		} catch (error) {
			obsidianProcess.kill();
			throw error;
		}
	}

	async close(): Promise<void> {
		// connectOverCDP close() only disconnects; the app process must be ended explicitly.
		// finally: if the CDP disconnect rejects (e.g. connection already dropped), the
		// Obsidian process must still be killed or it would outlive the suite as a zombie.
		try {
			await this.browser.close();
		} finally {
			await ObsidianHarness.killAndWaitForExit(this.obsidianProcess);
		}
	}

	/**
	 * Kills Obsidian and WAITS for the process to actually exit. WHY: a dying
	 * Obsidian still writes sandbox-config files (window state, workspace) on
	 * shutdown; returning before exit lets those writes race the next launch —
	 * observed as re-seeded window state being clobbered and as `ENOTEMPTY`
	 * when the next run wipes the vault dir.
	 */
	private static killAndWaitForExit(proc: childProcess.ChildProcess): Promise<void> {
		if (proc.exitCode !== null || proc.signalCode !== null) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			// Backstop: escalate if graceful shutdown hangs (bounded, condition-based).
			const forceKillTimer = setTimeout(() => proc.kill("SIGKILL"), FORCE_KILL_AFTER_MS);
			proc.once("exit", () => {
				clearTimeout(forceKillTimer);
				resolve();
			});
			proc.kill();
		});
	}

	/**
	 * Runs a command by its namespaced id: `<pluginId>:<commandId>`.
	 * Throws when Obsidian reports the command did not execute.
	 */
	async runCommand(commandId: string): Promise<void> {
		const executed = await this.page.evaluate(
			(id) => (window as unknown as { app: any }).app.commands.executeCommandById(id),
			commandId,
		);
		if (!executed) {
			throw new Error(`e2e: command did not execute: commandId=[${commandId}]`);
		}
	}

	// --- launch internals ---------------------------------------------------

	/**
	 * Fresh vault per run under `.tmp/e2e/vault`: the committed corpus notes at
	 * the vault root, minimal `.obsidian/` config, and the built plugin. No
	 * `data.json` is ever written — the plugin's DEFAULT settings are the
	 * contract (the retrieval gate's rank bounds are measured on defaults).
	 */
	private static assembleVault(): void {
		const builtPlugin = path.join(REPO_ROOT, "main.js");
		if (!fs.existsSync(builtPlugin)) {
			throw new Error(`Plugin build missing: file=[${builtPlugin}]. Run: npm run build`);
		}
		fs.rmSync(VAULT_DIR, { recursive: true, force: true });
		fs.mkdirSync(VAULT_DIR, { recursive: true });
		for (const name of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md"))) {
			fs.copyFileSync(path.join(CORPUS_DIR, name), path.join(VAULT_DIR, name));
		}
		const configDir = path.join(VAULT_DIR, ".obsidian");
		const pluginDir = path.join(configDir, "plugins", PLUGIN_ID);
		fs.mkdirSync(pluginDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, "app.json"), "{}");
		fs.writeFileSync(path.join(configDir, "appearance.json"), "{}");
		fs.writeFileSync(path.join(configDir, "community-plugins.json"), JSON.stringify([PLUGIN_ID]));
		for (const artifact of PLUGIN_ARTIFACTS) {
			fs.copyFileSync(path.join(REPO_ROOT, artifact), path.join(pluginDir, artifact));
		}
	}

	/**
	 * PERSISTENT `--user-data-dir` (deliberately NOT wiped between runs): it holds
	 * Chromium's HTTP cache of the ~100 MB embedding model + transformers.js
	 * fetched from the CDN (`src/iframe-runner.ts`, `env.useBrowserCache`);
	 * wiping it would re-download on every run. Only the plugin's IndexedDB
	 * (the search index, `src/index-store.ts`) is wiped: it is keyed by the
	 * `app://obsidian.md` origin, NOT by vault, so it would survive the fresh
	 * vault copy and the "unindexed vault" onboarding test would see run N-1's
	 * index. `obsidian.json` and the window state are re-written on EVERY
	 * launch — Obsidian overwrites the window file with the actual
	 * (headless-tiny) size at shutdown.
	 */
	private static prepareUserDataDir(): void {
		fs.mkdirSync(USER_DATA_DIR, { recursive: true });
		fs.rmSync(path.join(USER_DATA_DIR, INDEXED_DB_SUBDIR), { recursive: true, force: true });
		const obsidianJson = {
			updateDisabled: true,
			vaults: {
				[E2E_VAULT_ID]: { path: VAULT_DIR, ts: Date.now(), open: true },
			},
		};
		fs.writeFileSync(path.join(USER_DATA_DIR, "obsidian.json"), JSON.stringify(obsidianJson));
		ObsidianHarness.seedWindowState();
	}

	/**
	 * Per-vault window state Obsidian restores at boot (keyed by vault id):
	 * seed a real-sized window so headless runs don't default to ~300×200.
	 * See WINDOW_WIDTH_PX for WHY this matters to pointer-interaction tests.
	 */
	private static seedWindowState(): void {
		const windowStateJson = { width: WINDOW_WIDTH_PX, height: WINDOW_HEIGHT_PX, zoom: 0 };
		fs.writeFileSync(path.join(USER_DATA_DIR, `${E2E_VAULT_ID}.json`), JSON.stringify(windowStateJson));
	}

	/** Resolves the "DevTools listening on ws://…" endpoint from the app's stderr. */
	private static waitForDevtoolsEndpoint(proc: childProcess.ChildProcess): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let stderrSoFar = "";
			const timer = setTimeout(() => {
				reject(
					new Error(`Obsidian never announced a DevTools endpoint. stderr so far:\n${stderrSoFar}`),
				);
			}, LAUNCH_TIMEOUT_MS);
			proc.stderr?.on("data", (chunk: Buffer) => {
				stderrSoFar += chunk.toString();
				const match = stderrSoFar.match(/DevTools listening on (ws:\/\/\S+)/);
				if (match?.[1] !== undefined) {
					clearTimeout(timer);
					resolve(match[1]);
				}
			});
			proc.on("exit", (code) => {
				clearTimeout(timer);
				reject(new Error(`Obsidian exited before CDP was available: code=[${code}]\n${stderrSoFar}`));
			});
			proc.on("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
	}

	/** Waits for the vault window (`app://obsidian.md/...`) among the CDP-visible pages. */
	private static async waitForObsidianWindow(browser: Browser): Promise<Page> {
		const context = browser.contexts()[0];
		if (context === undefined) {
			throw new Error("CDP connected but Obsidian exposed no browser context");
		}
		const isVaultWindow = (page: Page): boolean => page.url().startsWith("app://obsidian.md");
		// State-poll (window creation AND its later navigation to app:// both
		// count) — CDP has no single event covering both, and the poll is bounded
		// and condition-based, not a race-masking sleep.
		const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const vaultWindow = context.pages().find(isVaultWindow);
			if (vaultWindow !== undefined) {
				return vaultWindow;
			}
			await new Promise((resolveTick) => setTimeout(resolveTick, WINDOW_POLL_INTERVAL_MS));
		}
		throw new Error(
			`No Obsidian vault window appeared. pages=[${context.pages().map((p) => p.url()).join(", ")}]`,
		);
	}

	private static async waitForWorkspaceReady(page: Page): Promise<void> {
		await page.waitForFunction(
			() => (window as unknown as { app?: any }).app?.workspace?.layoutReady === true,
			undefined,
			{ timeout: WORKSPACE_READY_TIMEOUT_MS },
		);
	}

	private static async enableCommunityPlugins(page: Page): Promise<void> {
		// A fresh sandbox shows first-boot modals (vault trust / release notes).
		// Escape dismisses them; plugin enablement below does not depend on the
		// modal's buttons, so this is best-effort cleanup, not a wait.
		await page.keyboard.press("Escape");
		await page.evaluate(async (pluginId) => {
			const app = (window as unknown as { app: any }).app;
			// setEnable(true) = the "Turn on community plugins" switch: persists the
			// flag and loads every plugin listed in community-plugins.json.
			await app.plugins.setEnable(true);
			await app.plugins.enablePlugin(pluginId);
		}, PLUGIN_ID);
		await page.waitForFunction(
			(pluginId) => Boolean((window as unknown as { app: any }).app.plugins.plugins[pluginId]),
			PLUGIN_ID,
			{ timeout: PLUGIN_READY_TIMEOUT_MS },
		);
	}
}
