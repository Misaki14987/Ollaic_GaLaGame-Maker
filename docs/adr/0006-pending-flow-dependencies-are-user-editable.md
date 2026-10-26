# Pending Flow Dependencies Are User Editable

V2 allows users to edit dependencies for pending Flow Steps instead of keeping the Agent Flow graph fully read-only. This makes FlowBoard a real generation planning surface rather than only a status viewer, but it requires cycle detection, dependency versioning, stale propagation, and resume-safe persistence before dependency edits can be trusted.
