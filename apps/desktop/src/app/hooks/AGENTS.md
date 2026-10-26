# Hooks and effects

- Keep hooks focused on state ownership, lifecycle, and synchronization; extract pure transformations into testable modules.
- Follow Hooks rules and exhaustive dependencies. User actions belong in handlers; effects synchronize external systems.
- Await promises or handle rejection explicitly. `void` alone does not handle errors.
- Dispose listeners, timers, and subscriptions. If asynchronous setup finishes after cleanup, dispose the newly created resource immediately.
- Guard late responses with request identities, cancellation, or lifecycle checks so they cannot update a different project, route, or selection.
- Give background work explicit completion, failure, and cancellation behavior. Distinguish a cancellation request from confirmed cancellation or a completed commit.
- Test stale responses, unmount, identity changes, and cleanup when changing asynchronous behavior. Use controlled synchronization rather than sleeps.
