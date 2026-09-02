Quick reference for setting up the Rust toolchain from scratch, written after walking Lotte through it over a screen share so I don't have to repeat the same explanation next time someone in the study group needs it. This covers `rustup`, the stable toolchain, `clippy`, `rustfmt`, and a couple of editor sanity checks that catch the most common first-day mistakes before they turn into confusing errors.

## Installing rustup and the stable toolchain

On macOS or Linux, run the official installer script rather than a package manager version, since distro-packaged Rust tends to lag behind and can conflict with `rustup` managing your toolchains later. The script prompts for a few options; accepting the defaults is fine for almost everyone starting out, and you can always customize the profile afterward once you know what you actually need.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
```

After the install finishes, open a new terminal window rather than reusing the old one, since the shell profile changes that add `cargo` to your `PATH` only take effect in fresh sessions. Verify everything landed correctly before moving on to anything else, because chasing a broken `PATH` later is far more annoying than catching it now while the install is still fresh in your head.

```bash
rustc --version
cargo --version
rustup show
```

You should see version numbers for both `rustc` and `cargo`, plus `rustup show` listing `stable-x86_64` (or your platform's equivalent) as the active, default toolchain. If any of these commands say "command not found," the `PATH` update didn't take, and the fastest fix is closing the terminal entirely and opening a brand new one rather than trying to manually source files in the old session, which tends to just paper over the symptom without actually fixing the underlying shell configuration.

Next, add the two components almost every Rust project ends up wanting: `clippy` for linting beyond what the compiler itself catches, and `rustfmt` for consistent formatting so code reviews don't turn into arguments about brace placement or import ordering.

```bash
rustup component add clippy
rustup component add rustfmt
```

Both install fast since they piggyback on the toolchain you already have locally. Test that they're wired up correctly by running them against a scratch project, which also doubles as your first real "hello world" moment with the toolchain end to end, from creation through build through lint.

```bash
cargo new hello_rust
cd hello_rust
cargo clippy
cargo fmt --check
```

`cargo clippy` should print a short "Finished" line with no warnings on a fresh project, since the template `main.rs` is deliberately clean. `cargo fmt --check` exits silently with no output when formatting is already correct, which it will be for a freshly generated project since `cargo new` writes already-formatted code by default. If you see warnings from clippy on a completely untouched fresh project, something is off with your installed component version, and the fix is almost always `rustup update` followed by removing and re-adding the component, since stale component versions occasionally drift out of sync with the toolchain version they're supposed to match against.

For editor integration, install `rust-analyzer` as an extension in whichever editor you use, VS Code, Zed, and most JetBrains IDEs all have first-party or well-maintained plugins. Point it at the same toolchain `rustup` just installed rather than a separate copy, since running two different toolchain installations side by side is a surprisingly common source of confusing, hard-to-explain version mismatches between what your editor reports and what actually runs when you invoke `cargo build` from the terminal. Restart the editor after installing the plugin; most of them need a fresh process to pick up the newly available toolchain and won't detect it if you just reload the window without a full restart.

One more thing worth doing on day one: run `rustup update` once now and set a calendar reminder to do it again in a month or so. The toolchain moves fairly quickly with new stable releases roughly every six weeks, and staying more than a couple of releases behind means you'll eventually hit tutorials or crate documentation that assume features your local toolchain doesn't have yet, which is a genuinely confusing class of error to debug when you don't yet know that toolchain version could even be the culprit behind an otherwise inexplicable compile failure on code that looks correct.

## Troubleshooting checklist

If something still feels off after following the steps above, work through this short list before asking for help. Run `rustup show` to confirm which toolchain is active, since multiple installs can silently shadow each other. Check that `~/.cargo/bin` appears in your `PATH` with `echo $PATH`, particularly on Linux where profile files vary. Finally, restart your editor completely, since `rust-analyzer` caches toolchain paths on startup. If none of that helps, uninstall with `rustup self uninstall` and start fresh; it's faster than debugging a half-broken install by hand.

