# Rust and Tauri

## Rust conventions

- Name modules/files/functions `snake_case`, types/traits `PascalCase`, constants/statics `SCREAMING_SNAKE_CASE`. Use the narrowest useful visibility and borrowed inputs where ownership is unnecessary.
- Return `Result<T, E>` for failures with meaningful error types and operation context; convert at transport boundaries. Recoverable production paths must not panic or silently substitute defaults.
- Keep blocking I/O and CPU-heavy work off async executor threads. Keep locks short, define lock ordering, and never hold a synchronous mutex guard across `.await`.
- Give spawned tasks an owner, cancellation policy, and error handling. Use RAII for resources; isolate `unsafe` and document its safety conditions.
- Keep platform-specific behavior behind small adapters. Use structured, redacted logging; remove temporary debug output.

## Commands and security

- Keep commands thin: validate/authorize, call application logic, map results. Core behavior stays testable without a webview or `AppHandle` unless native behavior requires one.
- Treat IPC as a public contract. Specify serialized names/tags and coordinate changes with [frontend clients](../src/app/lib/AGENTS.md); test both sides or regenerate authoritative bindings.
- Treat frontend input, imported files, provider responses, and model output as untrusted. Capabilities do not replace validation inside custom commands.
- Scope permissions to necessary windows/operations. Production webviews need explicit CSP; justify changes to remote origins, asset scope, or privileged operations.
- Resolve and validate scoped paths, including symlinks and nonexistent destinations. Validate external URL schemes/use; keep remote content outside privileged IPC.
- Launch processes with executable/argument arrays. Define timeouts, output limits, cancellation, and cleanup; never interpolate untrusted input into a shell.
- Bound network requests and downloads; validate destinations and redirects. Define an explicit policy for user-configured local services. Keep secrets in backend configuration or a credential store and redact diagnostics.
- Regenerate Tauri schemas/bindings with their owning tool. Keep auxiliary tooling and development dependencies out of normal release builds.

## Persistence

- Give persisted state one owner. Validate on load and distinguish missing, corrupt, and unsupported data; preserve unreadable user data for recovery.
- Use shared durable-write adapters. An interrupted save must preserve valid old/new data or an explicit recovery path.
- Define transaction, recovery, locking, and publication boundaries for multi-file writes. Serialize conflicting mutations and make retries idempotent where possible.
- Version persistent formats with migrations, backup, and failure behavior. Test reload, interruption, compatibility, and concurrent access using isolated temporary projects.

## Checks

- Run rustfmt checks, Clippy with warnings denied, and relevant tests. Use locked dependencies for CI and final verification.
- Cover supported feature configurations and auxiliary binaries separately; mutually exclusive features are not tested by `--all-features`.
- Validate changed native adapters on affected platforms; a browser build cannot verify them.
