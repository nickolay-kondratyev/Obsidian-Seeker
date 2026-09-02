# test-stubs/

`obsidian.ts` — runtime stub aliased over the types-only `obsidian` package for the whole vitest suite (`vitest.config.mts`). GOTCHA: a missing export becomes `undefined` at the point of use, not a clear error — when test code reaches for a new `obsidian` runtime value, add the stub export here. Tests mutate the shared `Platform` flags to pose as different devices.

`test-setup.mts` — vitest setup file (never shipped): aliases `window`/`activeWindow` to `globalThis` so the popout-window convention works under Node.
