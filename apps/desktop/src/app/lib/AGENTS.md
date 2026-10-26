# Frontend logic and IPC

- Keep pure domain transformations independent of React and Tauri. Put native calls behind typed client modules; components consume these clients.
- Define command arguments, results, error mapping, and side effects together. Use snake_case command names and camelCase JavaScript argument keys.
- For IPC contract changes, also read [Rust rules](../../../src-tauri/AGENTS.md). Update both sides in one change.
- Choose one authoritative schema; generate shared bindings where practical. For manually mirrored types, test serialized field names, enum tags, optional values, and error mapping.
- `invoke<T>()` provides no runtime validation. Validate external data at entry boundaries and preserve domain errors rather than returning invented success or empty results.
- Commands request work; events report state/progress with operation identities. Provide a state query for reconnecting views and dispose every subscription.
- Make cancellation and retry behavior explicit. Retrying must not duplicate committed side effects, and events from old operations must not update new state.
- Regenerate bindings with their owning tool; review generated diffs rather than editing output manually.
- Test business boundaries, serialization contracts, and failure behavior. Prefer injected adapters to mocks of private implementation details.
