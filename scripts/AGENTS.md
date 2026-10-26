# Development scripts

- Keep one canonical implementation per task; package scripts, CI, and documentation call it. Make path resolution independent of the caller's working directory.
- Validate arguments and configuration before mutation. Quote shell variables, pass subprocess arguments separately, and report failures with actionable context.
- Use bounded network/process operations and clean up temporary resources on failure or interruption. Keep retries idempotent and destructive targets explicit.
- Read secrets from protected configuration/environment; redact output and avoid placing credentials in command arguments or fixtures.
- Follow the shared formatting baseline for JS/TS. Shell scripts should fail on unhandled errors and unset variables where supported.
- Test meaningful behavior in temporary directories, especially failure, repeat invocation, and version decisions. Use `node --test` for Node test files and syntax checks for changed shell scripts.
