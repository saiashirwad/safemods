Value simplicity and low complexity in code — when writing or reviewing code, favor the simplest design, deleting dead code/abstractions over adding layers.

Tautological tests considered harmful

note: this is a GREENFIELD project. no one uses it. we can make breaking changes (no aliases, shims or deprecated re-exports — migrate every caller)

## Commands (cheapest first)

| Command                                    | Time  | Use                                                                           |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------------- |
| `pnpm check:file <paths>`                  | ~1.5s | inner loop: oxlint + dprint on the paths, tsc project-wide                    |
| `pnpm exec vitest run test/<path>.test.ts` | secs  | the one test file for what you changed                                        |
| `pnpm check:fast`                          | ~3s   | fmt:check, typecheck, oxlint, knip, selfcheck (also pre-push, with test:fast) |
| `pnpm check`                               | ~20s  | check:fast + full tests                                                       |
| `pnpm verify`                              | min   | before a PR: check + coverage + mutation (~52s) + check:release (~9s)         |

Quiet on success. Also: `test:fast`, `test:changed`, `pnpm example <id>` (run one example), `pnpm safemods <command>`.

Which gate catches what: unused code/exports → knip + `selfcheck` (`Checks.unusedCode`); a test that doesn't pin its behavior → `mutation` (`--list`, `--only <id>`); packaging/exports map → `check:release`; coverage ratchet → `coverage`.

## Navigate before reading

`fixtures/` is excluded from search by `.ignore`: it is input under test. Look in `src/` and `test/` first.

```
node --conditions=source src/bin.ts map                          # whole module graph: lines, exports, importers (~2k tokens)
node --conditions=source src/bin.ts deps src/Query/index.ts      # imports and importers
node --conditions=source src/bin.ts exports src/Query/index.ts   # exports with types
node --conditions=source src/bin.ts type src/Query/nodes.ts:75:14   # type + declaration at file:line:col
node --conditions=source src/bin.ts refs src/Query/nodes.ts:75:14   # every reference, through aliases
node --conditions=source src/bin.ts calls src/Query/nodes.ts:75:14  # every direct call
```

Same commands via `pnpm safemods <command>`. TS7 AST API: guards in `node_modules/typescript/dist/ast/is.generated.d.ts` (`isX`), node kinds in `ast.generated.d.ts` there; import from `typescript/unstable/ast/is`, `typescript/unstable/ast`, `typescript/unstable/async`.

## Layout

- Test path mirrors source path: `src/X.ts` → `test/X.test.ts`, `src/Dir/Y.ts` → `test/Dir/Y.test.ts`. Cross-cutting: `test/Pipeline`, `ProposalSafety`, `RecipeBoundary`, `examples-registry`, `Checks/slop`, `Checks/structure`.
- `test/migrations/<id>.test.ts` mirrors `examples/<id>.ts`.
- Layer order lives only in `safemods.config.ts` (`Checks.layers`); `selfcheck` enforces it.
- Public API: only the root `safemods` export, `src/index.ts` (namespaces; `publicApi` in `safemods.config.ts`). Scope queries with `Query.files(project, [glob])`; report with `Check.report(at, message)`.

## Recipes: adding an example

`examples/<id>.ts` + `fixtures/migrations/<id>/` (sources; `expected/` via `UPDATE_FIXTURES=1 pnpm exec vitest run test/migrations/<id>.test.ts`) + `test/migrations/<id>.test.ts` + one `entry(recipe, input)` in `examples/run.ts`. `test/examples-registry.test.ts` enforces recipe file, fixture dir and test per id.

## Tests

- `withProject(files, use)` / `withFixture(use, options)` (`test/utils/fixture.ts`) start from an empty project; pass `fixture: "recipe"` for the shared sources in `fixtures/recipe`.
- `expectMigration(recipe, "migrations/<id>", input?)` (`test/utils/expect-migration.ts`): applies the recipe to a copy of the fixture, compares the tree with `expected/`, asserts a rerun proposes nothing.
- Mutation anchors: `// mutant: <id>` comment directly above the mutated line; move it with the code.

## Rules and what enforces them

| Rule                                                           | Enforced by                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| Everything `pnpm check` runs works on Linux, macOS and Windows | the three-OS CI matrix                                     |
| A test fails when the behavior it names changes                | `pnpm mutation`                                            |
| The suite keeps global coverage at or above the ratchet        | `pnpm coverage`                                            |
| Formatting                                                     | `pnpm fmt:check` (dprint); `pnpm fmt` fixes                |
| Types                                                          | `pnpm typecheck` (tsc)                                     |
| No unused code, exports or optional parameters                 | `pnpm lint` (oxlint, knip) and `pnpm selfcheck` (safemods) |
| Layer order, weak returns, ignored returns, duplicated code    | `pnpm selfcheck` (`safemods.config.ts`)                    |
| Packed package works for a consumer                            | `pnpm check:release`                                       |
| Scripts use Effect platform services, not raw `node:` I/O      | the `scripts` override in `oxlint.config.ts`               |
