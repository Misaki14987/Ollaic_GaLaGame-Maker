# Engineering documentation

- Document observable behavior, interface constraints, failure modes, and decisions with their rationale and tradeoffs. Separate implemented behavior from proposals and target standards.
- Keep commands aligned with their canonical scripts. Update setup/configuration guidance when its prerequisites or defaults change.
- During documentation updates, compare descriptions with the current implementation. Remove or update obsolete content and stale references, consolidate redundant coverage, and keep active proposals clearly labeled.
- Keep each rule authoritative in one place; link to it rather than copying it. Add conditional reading pointers when a rule is only needed for a particular kind of change.
- Keep directory `AGENTS.md` files short and scoped. Move specialized rules to their owning directory rather than enlarging the root instructions.
- For documentation-only changes, check links, examples, scope, and formatting; application tests are unnecessary unless executable examples or tooling change.
