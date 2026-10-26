# Development rules

Apply these rules throughout the repository, plus the `AGENTS.md` files governing the directories you edit. For ownership and navigation, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Shared conventions

- Write new engineering documentation, identifiers, and explanatory comments in English. Keep product text in its chosen language.
- Give each module one clear responsibility. Keep presentation, application logic, native adapters, and persistence separate; dependencies point toward domain logic.
- Use consistent domain names. Comments explain constraints and reasoning; types and names explain routine behavior.
- Format JS/TS/TSX/JSON/CSS with Prettier: 2 spaces, no tabs, semicolons, single JS quotes, double JSX quotes, trailing commas (`all`), bracket spacing, arrow parentheses (`always`), print width 100, LF. JSON keeps double quotes. Rust uses rustfmt defaults and the crate's edition.
- Use UTF-8 and LF unless the file format requires otherwise. Preserve unrelated edits; separate broad formatting and dependency updates from behavior changes.
- Use one JS package manager and its committed lockfile; commit the application's Cargo lockfile. Use repository scripts and locked installation. Review dependency changes with their lockfile diff.
- Store local-only research, reports, prototypes, and scratch artifacts under `_local/`; keep it Git-ignored and never force-add its contents. Preserve existing material during routine cleanup.

## Verification and review

- Test observable behavior and meaningful failures. Add a reliable regression test for a bug fix; cosmetic changes need appropriate visual or formatting checks, not artificial tests.
- Keep default tests deterministic and offline: temporary projects/profiles, injected providers, controlled clocks, sanitized fixtures. Review snapshot changes before accepting them.
- Run scoped checks while iterating, then applicable full checks before handoff. Read script definitions: a build does not prove type safety, and a browser test does not prove native integration.
- Fix violations at their source. A narrow suppression or temporary baseline needs a reason, scope, and removal condition; do not weaken checks to pass.
- Report what changed, what was verified, and any failed or skipped checks. PRs explain behavior, compatibility, and migration risks; use descriptive Conventional Commit subjects.
- Documentation defines the target standard, not proof that tooling enforces it. When changing enforcement, follow [.github/AGENTS.md](.github/AGENTS.md); document exceptions and consequential architecture decisions.
