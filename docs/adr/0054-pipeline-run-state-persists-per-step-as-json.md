# Pipeline run state persists as JSON after each step transition

A pipeline run persists its `RunState` (step statuses, run status, timestamps) as JSON to `.ollaic/pipeline/<run_id>.json`, written **after every step transition** (started / succeeded / failed / skipped), not once per node or once per run.

This granularity directly satisfies the V2 acceptance criterion "resume from the last incomplete step after a crash, without redoing completed work": on restart, steps already `succeeded` are skipped and the run continues from the next ready step. JSON is the format already used everywhere else in the project (`characters.json`, `asset-metadata.json`, `ai-memory.json`) and `serde_json` is already a dependency, so the run-state file stays human-debuggable. Per-node persistence was rejected as too granular and noisy for no resume benefit; once-per-run was rejected as too coarse to survive a mid-run crash.
