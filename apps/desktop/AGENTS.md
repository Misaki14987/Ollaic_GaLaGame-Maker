# Desktop application rules

## TypeScript and frontend structure

- Enable strict typechecking. Narrow `unknown` at input boundaries; model missing values explicitly. Avoid `any`, non-null assertions, and casts that conceal a missing contract.
- Use discriminated unions for exclusive states. Keep authoritative state near its owner and derive secondary values instead of synchronizing copies.
- Use named exports for shared modules and `import type` for types; use the agreed automated import ordering. Default exports are for framework/tool requirements.
- Name components and files `PascalCase`, hooks `usePascalCase`, other source files `kebab-case`, functions/properties `camelCase`, types `PascalCase`, and fixed module constants `SCREAMING_SNAKE_CASE`.
- Keep privileged filesystem, process, credential, and OS operations in Rust. Frontend build variables are public; keep secrets in backend configuration or an OS credential store.

## Read when applicable

- For native code, Tauri configuration, or backend resources, read [Rust rules](src-tauri/AGENTS.md).
- For UI changes, read [component rules](src/app/components/AGENTS.md), including UI outside that directory.
- For custom hooks or effects, read [hook rules](src/app/hooks/AGENTS.md), including colocated hooks.
- For IPC, domain types, or pure frontend logic, read [library rules](src/app/lib/AGENTS.md).
- For CSS or visual tokens, read [style rules](src/styles/AGENTS.md), including component-local CSS.
- For browser journeys, read [E2E rules](e2e/AGENTS.md).

## Checks

- Use ESLint for correctness and Prettier for formatting. Check Hooks rules, unused code, and unsafe promise handling with suitable type-aware rules.
- For frontend logic or interaction changes, run relevant tests, strict typechecking, lint over changed source, and the production build. Keep `*.test.ts(x)` near the subject.
- Keep test data outside real user projects. Test loading, failure, stale responses, and recovery when those paths change.
