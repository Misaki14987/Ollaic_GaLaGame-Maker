# Run History Cleanup Keeps Pinned Runs

Step Run History uses a bounded cleanup policy by default, keeping recent attempts while allowing users to pin important runs and manually clean up or export history. This prevents `.ollaic` storage from growing without limit while preserving the traceability users deliberately mark as valuable.
