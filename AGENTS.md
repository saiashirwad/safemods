Value simplicity and low complexity in code — when writing or reviewing code, favor the simplest design, deleting dead code/abstractions over adding layers.

Tautological tests considered harmful

note: this is a GREENFIELD project. no one uses it. we can make breaking changes

## Rules and what enforces them

| Rule                                                           | Enforced by                                     |
| -------------------------------------------------------------- | ----------------------------------------------- |
| Everything `pnpm check` runs works on Linux, macOS and Windows | the three-OS CI matrix                          |
| A test fails when the behavior it names changes                | `pnpm mutation`                                 |
| The suite keeps global coverage at or above the ratchet        | `pnpm coverage`                                 |
| Formatting                                                     | `pnpm fmt:check` (dprint)                       |
| Types                                                          | `pnpm typecheck` (tsc)                          |
| No unused code, exports or optional parameters                 | `pnpm lint` (oxlint, knip, safemods self-check) |
| Scripts use Effect platform services, not raw `node:` I/O      | the `scripts` override in `oxlint.config.ts`    |
