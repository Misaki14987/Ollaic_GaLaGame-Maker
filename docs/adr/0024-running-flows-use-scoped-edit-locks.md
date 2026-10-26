# Running Flows Use Scoped Edit Locks

While an Agent Flow is running, V2 uses scoped Flow Locks for the scenes, assets, characters, or records currently being read or written by active Steps instead of locking the whole Project. Users may continue editing unrelated content, and those edits apply Flow Impact invalidation so FlowBoard can keep Playability trust current without causing write races.
