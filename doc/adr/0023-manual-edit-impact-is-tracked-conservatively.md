# Manual Edit Impact Is Tracked Conservatively

V2 should map manual edits to the smallest reliable Flow Impact, such as the edited Scene Step and its downstream review, asset, and export checks. When the system cannot confidently trace the affected Steps, it must conservatively mark broader downstream Quality Gates stale rather than preserving a misleading Playability Level.
