# Browser journey tests

- Assert user-visible behavior and resulting state using role/label locators and stable domain identifiers.
- Isolate projects, configuration, and fixtures per test. Keep external providers deterministic and offline by default.
- Synchronize on observable conditions with bounded waits, not fixed sleeps or test ordering.
- Cover meaningful failure and recovery paths for changed critical journeys. Review screenshots/snapshots before updating baselines.
- Use the configured test runner and server lifecycle; avoid competing servers or real user profiles.
- Browser checks cover web behavior. Validate native dialogs, capabilities, resources, and OS integration with separate desktop checks when affected.
