# WebGPU on Linux — make Seeker index on your GPU

Back to the main [README](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/README.md).

Seeker runs the embedding model on your GPU through WebGPU when it can, and falls back to the CPU (WASM) otherwise. Search works either way, but indexing on the CPU is much slower. On Linux, Obsidian's Electron often ships with WebGPU disabled: `navigator.gpu` exists but no GPU adapter is handed out, so Seeker silently lands on the CPU even with **Compute → Force WebGPU** set. Seeker tells you when this happens: the top of its settings tab reads "Running on: CPU (WASM). WebGPU was requested but …", and a pop-up appears whenever a full reindex starts.

## Fix

Verified 2026-09-02 on Fedora Linux, AMD Ryzen AI MAX+ 395 with Radeon 8060S, Obsidian 1.13.7 Flatpak, Electron 43 / Chrome 150. Launch Obsidian with these flags:

```
--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist
```

- **Flatpak**: append each flag on its own line to `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf`, then restart Obsidian.
- **AppImage / rpm / tarball**: run `obsidian <flags>`, or add the flags to the `Exec=` line of Obsidian's `.desktop` file.

## Verify

Open the developer console (Ctrl+Shift+I) and run `await navigator.gpu?.requestAdapter()`. It should return a non-null adapter whose `info.vendor` is not `google` (`google` is Chromium's software renderer, which Seeker rejects because it is slower than the CPU). Seeker's settings tab then shows "Running on: WebGPU — <vendor> <description>".

## Still not working?

- Add `--ozone-platform=x11` (Wayland issues).
- Add `--disable-gpu-compositing` only if you see grey video artifacts.
- To silence the warning instead, pick **Compute → Force CPU** in Seeker settings.
