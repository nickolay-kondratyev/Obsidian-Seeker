import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the real-Obsidian e2e suite (`npm run test:e2e:obsidian`).
 *
 * The suite drives ONE real Obsidian (Electron) instance on a vault assembled
 * per run under `.tmp/e2e/vault` — see `obsidianHarness.ts`. It is intentionally
 * NOT part of `npm test` (unit gate stays fast and hermetic); vitest's default
 * include (`*.test.*` / `*.spec.*`) never matches `*.e2e.ts`.
 */

/** Booting a desktop Electron app + vault index is slow; unit-test timeouts don't apply. */
const TEST_TIMEOUT_MS = 120_000;
/** Plugin re-renders often ride debounces + metadata reindex; expect-retries need headroom. */
const EXPECT_TIMEOUT_MS = 15_000;

export default defineConfig({
	testDir: ".",
	testMatch: "**/*.e2e.ts",
	timeout: TEST_TIMEOUT_MS,
	expect: { timeout: EXPECT_TIMEOUT_MS },
	// One Obsidian instance, serial tests — parallel workers would fight over
	// the singleton app window and the vault copy.
	workers: 1,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	// Resolved relative to THIS file's directory (e2e/), hence the `../`.
	outputDir: "../.tmp/e2e/test-results",
});
