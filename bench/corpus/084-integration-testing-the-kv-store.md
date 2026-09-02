---
tags: [rust, how-to, testing]
created: 2026-05-19
status: active
---

Notes on writing integration tests that spawn the actual key-value store binary and talk to it over a real TCP socket, rather than testing the internal functions directly, since the whole point of [[082-key-value-store-project]] is verifying the protocol and concurrency behavior end to end, not just individual pieces of logic in isolation.

## Setting up the test harness

Start by creating a `tests/` directory at the crate root, separate from `src/`, since Cargo automatically compiles anything in `tests/` as a standalone integration test binary with access only to your crate's public API, exactly the black-box boundary you want when testing a network protocol rather than internal implementation details that might change shape later without breaking any real behavior. Each file becomes its own test binary, so a single `tests/server.rs` is enough here; no need to split further until it grows unwieldy.

The first real decision is how to start and stop the server binary around each test. Spawning the actual compiled binary as a subprocess, using `std::process::Command`, is more realistic than importing server internals and calling functions in-process, since it exercises the exact path a real client would hit, socket binding, connection acceptance, everything, rather than assuming the networking layer already works. The tradeoff is slower tests and more setup ceremony, binding to an available port, waiting for readiness, and cleaning up the child process afterward even when a test panics partway through and would otherwise leave an orphaned process eating a port other tests need.

Bind to port zero and let the OS assign an available port rather than hardcoding one, which avoids collisions when tests run in parallel, Cargo's default test behavior, and also avoids the flaky failures I hit during the file watcher project whenever a fixed port was still held by a previous run's now-dead process. The server needs a small change: print the actually-bound port to stdout on startup so the harness can read it back, a change worth making permanently anyway, useful for local manual testing too, letting you run several instances side by side without tracking ports manually.

For readiness, don't just sleep a fixed duration and hope the server is up in time, exactly the flaky pattern that works fine on your laptop and fails intermittently in CI where machines are slower and busier. Instead, poll: attempt a TCP connection in a short retry loop with a small delay between attempts, treating a successful connection as the readiness signal, and give up with a clear panic message after a handful of failed attempts so a genuinely broken build fails fast instead of hanging the whole suite without any useful diagnostic.

Once the harness can start a server, connect a client, and clean up reliably, the individual test cases become straightforward: write `SET foo bar` followed by a newline, read back the response line, assert it equals `OK`, then `GET foo` and assert the value round-trips correctly through the whole encode-decode path rather than just in memory. For the concurrency behavior specifically, the interesting part this project actually cares about, spawn several client connections from separate threads inside one test, each hammering `SET` and `GET` against overlapping keys simultaneously, then assert the final state is internally consistent rather than corrupted or silently dropped, since consistency under real concurrent access is precisely the property a thread-per-connection design with a shared, mutex-guarded map is supposed to guarantee correctly even under contention.

Wrap the child process handle in a small guard struct that kills it in a `Drop` implementation, so the process gets cleaned up automatically even if a test panics partway through and would otherwise skip past any explicit cleanup code written later in the same function body. This one pattern alone saved me from several confusing "address already in use" failures on subsequent test runs, back when I was manually killing the process at the end of each test function and a single early assertion failure meant that cleanup code never actually ran at all, silently leaving a zombie process squatting on whatever port it had happened to bind to that particular run.

## What this caught immediately

Running the concurrent `SET`/`GET` test against the current build immediately reproduced the lock-scoping bug Kofi and I suspected but hadn't pinned down, confirming the mutex was briefly held across a network read in one code path, serializing clients that should have run independently of each other. Worth writing before adding any more commands to the protocol, since bugs like this tend to compound quietly and get harder to isolate the longer they sit undetected in a growing codebase.

