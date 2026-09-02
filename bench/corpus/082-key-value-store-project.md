Small key-value store with a TCP protocol, project three for the study group, decided at [[081-study-group-midpoint-planning]] over a web scraper because it exercises ownership, error handling, and basic concurrency together in one project. Goal: a server process that accepts plain-text commands over a socket, holds everything in memory, and responds line by line, no persistence in version one. Meant to be the most production-shaped project so far, closer to something real than the todo app or file watcher before it.

## Requirements

Protocol is deliberately simple, plain-text commands over TCP, one per line, closer to `redis-cli` than any binary wire format: `SET key value`, `GET key`, `DEL key`, each terminated by a newline and answered with a single-line response, `OK`, the value itself, or `ERR` plus a short reason. The server must handle multiple simultaneous client connections without one slow or misbehaving client blocking the others, which is the actual concurrency lesson this project is built around. No authentication, no TLS, no persistence to disk for version one; the whole store lives in memory and resets on restart. Kofi is scaffolding the workspace this week, following [[069-cargo-workspace-setup]], splitting protocol parsing into its own crate so it stays testable independent of networking.

## Design notes

Concurrency model is a thread per connection to start, deliberately the simplest thing that could work, with `tokio` as an explicit stretch goal once the synchronous version is solid. Shared state is a single `HashMap<String, String>` wrapped in `Arc<Mutex<...>>`, which Dana pointed out is the textbook example of interior mutability, and building it by hand taught me more about `Arc` and `Mutex` in an afternoon than the book chapter managed on its own. Parsing uses a small hand-rolled tokenizer rather than a parser combinator crate, since the grammar is trivial.

```rust
fn parse_command(line: &str) -> Result<Command, ProtocolError> {
    let mut parts = line.trim().splitn(3, ' ');
    match parts.next() {
        Some("SET") => {
            let key = parts.next().ok_or(ProtocolError::MissingKey)?;
            let value = parts.next().ok_or(ProtocolError::MissingValue)?;
            Ok(Command::Set(key.to_string(), value.to_string()))
        }
        Some("GET") => Ok(Command::Get(parts.next().ok_or(ProtocolError::MissingKey)?.to_string())),
        Some(other) => Err(ProtocolError::UnknownCommand(other.to_string())),
        None => Err(ProtocolError::EmptyLine),
    }
}
```

Each connection gets its own thread reading a `BufReader` line by line, locking the shared map only for the read or write itself, never across network I/O, a mistake in the first draft that serialized every client behind whichever one was slow.

## Status

Basic `SET` and `GET` work against a single connected client using `nc` for manual testing. Multi-client handling is untested past two simultaneous connections; Kofi is writing a small load-testing script this week to push that further before we trust it under anything resembling real concurrent load in front of actual traffic. `DEL` still has an off-by-one bug dropping the wrong key occasionally under quick successive calls.

## Next steps

- [ ] Write integration tests spawning the server and multiple client threads
- [ ] Add a `LIST` command for debugging what keys currently exist
- [ ] Investigate the `tokio` rewrite once threading feels solid
- [ ] Ask Lotte to review the lock-scoping for any case the mutex might still span I/O
- [ ] Fix the `DEL` off-by-one bug before the next session
- [ ] Decide whether a write-ahead log for crash recovery is worth the complexity here

Ending this phase of the study group on the most production-shaped project felt right, since the earlier two were mostly about fundamentals in isolation rather than anything resembling a real service under load.
