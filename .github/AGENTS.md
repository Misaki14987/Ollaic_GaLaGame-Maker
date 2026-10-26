# CI and release automation

## Quality gates

- Use canonical repository commands and compatible pinned toolchains. Install from committed lockfiles without silently updating dependencies.
- Target frontend format/lint checks over all maintained source, strict typechecking independent of bundling, relevant tests, and a production build.
- Target Rust checks: `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, and `cargo test --locked --workspace` for supported feature configurations. Cover optional tooling separately.
- Check generated contracts for drift when generation is used. Test native packaging on supported operating systems before release.
- Keep temporary exclusions explicit, scoped, tracked, and removable. Configure required checks in branch protection; hooks alone are not enforcement.
- Document actual script coverage. A `verify` command must state its gates; do not present target requirements as existing enforcement.

## Workflow safety and releases

- Use minimum token permissions; pin third-party actions to reviewed immutable revisions. Keep secrets out of untrusted PR execution, logs, and artifacts.
- Cache dependencies/build outputs with keys that reflect toolchain and dependency inputs. Keep tests independent of cache contents.
- Keep one authoritative app version and synchronize metadata through tooling. Review version decisions and lockfile changes with release-script tests.
- Build from an identifiable revision with locked dependencies. Protect signing/update keys; verify installers, startup, bundled resources, and upgrades.
- Document permission/configuration/format changes and recovery limits. A frontend build is not an installer or updater test.
- Schedule dependency/security checks; review findings and validate automated upgrades.
