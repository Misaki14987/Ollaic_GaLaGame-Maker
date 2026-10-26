# Pipeline events stream over the Tauri AppHandle event bus

Pipeline step/run events are emitted through Tauri's `AppHandle::emit` on a per-run channel `pipeline:{run_id}`, not over a standalone WebSocket.

The codebase already emits its async progress this way (`ai-chat-{request_id}`, `batch-tts-progress`, `ai-media-generation-progress`), the V2 data-flow diagram labels this transport "Tauri event / IPC", and the < 1 s node-sync-latency acceptance is met trivially. The runtime server's existing WebSocket is reserved for WebGAL runtime sync, not pipeline telemetry. A standalone WS would add a second transport and lifecycle to maintain for no gain.
