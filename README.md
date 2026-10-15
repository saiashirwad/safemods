# safemods

Type-directed codemods for TypeScript 7, built on Effect.

Pre-alpha. Recipes use the compiler to choose edits, then verify the proposal before applying it. Checks use the same scoped compiler snapshots to report findings.

## Rename the symbol, not every matching word

`examples/rename-through-barrel.ts` renames the accounts module's `loadAccount` to `findAccount`. It follows the symbol through barrels and import aliases. These excerpts come from its fixture:

```diff
 // src/accounts/store.ts
-export function loadAccount(accountId: string): Account {
+export function findAccount(accountId: string): Account {

 // src/accounts/index.ts
-export { loadAccount as lookupAccount } from "./store.js"
+export { findAccount as lookupAccount } from "./store.js"

 // src/billing/invoices.ts
-import { /* billing still binds the public name */ loadAccount as fetchAccount } from '../accounts/store.js'
+import { /* billing still binds the public name */ findAccount as fetchAccount } from '../accounts/store.js'
```

Calls through the local `fetchAccount` alias and public `lookupAccount` alias stay unchanged. The unrelated `loadAccount` in `src/users/directory.ts` stays unchanged too. A text replacement cannot make that distinction.

From a repository checkout, run `pnpm install`, then `pnpm example rename-through-barrel`. The runner copies the fixture and prints the applied diff; it never changes the original fixture.

Not every mention is a compiler reference. The separate `examples/rename-symbol.ts` recipe reports plain-text mentions in edited files rather than guessing. Its CLI test renames the JSDoc link in `/** Use {@link area}. Example: area(2) */` but leaves `area(2)` for review:

```text
left for you (1):
  packages/app/src/lib.ts:1:32 mentions area in a comment or string the compiler cannot resolve
```

The barrel recipe leaves comments and strings untouched without reporting them. Unsupported findings are information for the caller, not an automatic verification failure.

## Use in your project

Requires Node 24+. In an ESM project, install the tool and the dependencies imported by your recipe:

```sh
pnpm add -D safemods effect@4.0.0-rc.109 typescript@7.0.2
```

The package currently pins TypeScript `7.0.2` and Effect/platform packages `4.0.0-rc.109`. Recipes use TypeScript's unstable AST API and Effect 4 APIs. These are the tested versions, not a compatibility promise for other releases. The recipe's imports are authoring dependencies; safemods reads the target project's tsconfig using its own pinned compiler, not whichever compiler the target has installed.

Save this small recipe in `recipes/remove-debugger.ts`:

```ts
import { Effect } from "effect"
import { isDebuggerStatement } from "typescript/unstable/ast/is"
import { Proposal, Query, Recipe } from "safemods"

export default Recipe.perProject("remove-debugger", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const statements = yield* Query.nodes(project, isDebuggerStatement)
      return Proposal.concat(
        ...statements.map(({ value }) => Proposal.remove(project, value)),
      )
    }),
})
```

`Recipe.perProject` runs against every configured project and combines their proposals. For a transformation that selects a project or coordinates several, use `Recipe.define` with `run: (snapshot, input) => ...`; the snapshot is an explicit argument, not an Effect service.

List the workspace's projects in `safemods.config.ts`:

```ts
import { Config } from "safemods"

export default {
  projects: [{ id: "app", config: "tsconfig.json" }],
} satisfies Config.Config
```

Preview first, then apply:

```sh
pnpm exec safemods run recipes/remove-debugger.ts
pnpm exec safemods run recipes/remove-debugger.ts --apply
```

Preview prints a contextual unified diff. Check it before passing `--apply`. For recipes with an input schema, pass JSON with `--input`. Without `--apply`, verification writes nothing.

## What verification guarantees

By default, verification rejects introduced compiler **errors**, not every diagnostic. A recipe can allow new errors with `diagnostics: "allow-new-errors"`. Compiler diagnostics depend on the configured projects and their options; JavaScript with `checkJs: false` does not receive the same checks as checked source.

Recipes can set `maxAffectedFiles` to cap changed files and `idempotence: "required"` to reject changes proposed on a second run. There is no file limit by default, and idempotence is opt-in. Verification also validates proposals and checks captured inputs for staleness before returning and before application.

Diagnostic matching compares project, filename, category, code, and message, but ignores position and accounts for file moves. Matching preserves error counts. An old error removed in one place can mask an identical error introduced elsewhere in the same file and project.

These checks do not prove runtime equivalence. Review the diff and run the target project's tests. For example, CommonJS-to-ESM conversion can change import timing, live bindings, and `module.exports` overwrite behavior even when the result parses. The example exports existing top-level `const` bindings with export clauses and reports mutable or unresolved identifier exports as unsupported. It is not a general CommonJS compatibility transform.

Cheap syntactic filters go first. `Query.where` asks the checker, and questions asked about many nodes at once are sent as one request per file.

## Checks

A check has a `run(snapshot)` callback returning an Effect of findings: a file, a span and a message. Questions about types go through the project snapshot, and `Type` reads Effect, Stream and Layer parameters off their variance structs.

`examples/no-unknown-failures.ts` is one, and this repository runs it on itself:

```ts
import { Effect, Option } from "effect"
import type { Type as NativeType } from "typescript/unstable/async"
import { Check, Query, Type, Workspace } from "safemods"

const failureOf = (project: Workspace.ProjectSnapshot, type: NativeType) =>
  Effect.gen(function* () {
    const effect = yield* Type.effect(project, type)
    if (Option.isSome(effect)) return Option.some({ kind: "an Effect", error: effect.value.error })
    const stream = yield* Type.stream(project, type)
    if (Option.isSome(stream)) return Option.some({ kind: "a Stream", error: stream.value.error })
    const layer = yield* Type.layer(project, type)
    if (Option.isSome(layer)) return Option.some({ kind: "a Layer", error: layer.value.error })
    return Option.none()
  })

export const noUnknownFailures = (options: { readonly within: string }) =>
  Check.perProject("no-unknown-failures", (project) =>
    Query.files(project, [options.within]).pipe(
      Effect.flatMap(Query.calls),
      Query.typed,
      Effect.flatMap((calls) =>
        Check.each(calls, (call) =>
          Effect.map(failureOf(project, call.value.type), (failure) =>
            Option.toArray(failure)
              .filter(({ error }) =>
                Type.isUnknown(error)
              )
              .map(({ kind }) =>
                Check.report(
                  call,
                  `returns ${kind} that can fail with unknown: give the failure a type`,
                )
              )))
      ),
    ))
```

List projects and checks in `safemods.config.ts`. Every path — a project config, a `within` glob, an edit, a finding — is relative to the directory holding that file. The rules that ship with the package are the `Checks` namespace of `safemods`; a rule of your own is a file in your repository.

```ts
import { Config, Checks } from "safemods"
import { noUnknownFailures } from "./checks/no-unknown-failures.ts"

export default {
  projects: [{ id: "app", config: "tsconfig.json" }],
  checks: [
    Checks.layers({ within: "src/**", order: [["src/core.ts"], ["src/app.ts"]] }),
    noUnknownFailures({ within: "src/**" }),
  ],
} satisfies Config.Config
```

```sh
safemods check               # exit 1 on findings, 2 if the run failed
safemods check --format json
```

### Rules that ship in `Checks`

| Rule                       | Reports                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `layers`                   | an import that points at a module listed below the importer; an entry ending in `/` is a folder                                                        |
| `weakReturns`              | a function whose resolved return type is `any` or `unknown`, seen through unions, promises and an Effect's success channel                             |
| `restrictedReferences`     | a use of one declaration outside the files allowed to use it, through any alias or re-export                                                           |
| `typeBoundaries`           | an export whose type mentions a type declared in a forbidden file or package, even with no import of it                                                |
| `unjustifiedCasts`         | an `as` the checker cannot confirm: from `any` or `unknown`, a narrowing, or between unrelated types; a cast that was already assignable is left alone |
| `unusedCode`               | an export outside the public API that nothing uses, or that only tests use                                                                             |
| `unusedOptionalParameters` | an optional parameter no caller passes; silent when the function is used other than by calling it, since not every caller is visible then              |
| `ignoredReturns`           | a function whose return value every caller drops                                                                                                       |
| `duplicatedFunctions`      | the same function body written out in more than one file                                                                                               |
| `importCycles`             | an import that leads back to its own file; `typeImports` decides whether `import type` edges count                                                     |
| `oversized`                | a function over a line or parameter limit, a file over a line limit                                                                                    |
| `anyInPublicApi`           | a public export whose type contains `any`, followed through namespace re-exports                                                                       |
| `suppressions`             | `@ts-ignore`, `@ts-expect-error`, lint-disable comments and `!` assertions                                                                             |

This repository enables some of these rules in `safemods.config.ts`; `pnpm selfcheck` runs that config. It leaves `unjustifiedCasts` off because `src/` has deliberate casts, and `anyInPublicApi` off because its type walk reaches `any` inside Effect's declarations through otherwise typed public exports.

## Asking the compiler

The same config answers questions, for a person or an agent that would otherwise grep and read files:

```sh
safemods map                         # every file: lines, exports, how many files import it
safemods deps src/Query/index.ts     # what it imports and what imports it
safemods exports src/Query/index.ts  # its exports with their types
safemods type src/Query/nodes.ts:75:14    # the type and declaration of what is there
safemods refs src/Query/nodes.ts:75:14    # every reference, through aliases and re-exports
safemods calls src/Query/nodes.ts:75:14   # every direct call, and whether other uses exist
safemods type src/shared.ts:1:12 --project app
```

If a file belongs to more than one project, the inspection commands require `--project`. `map` labels each compiler context. Workspace snapshots return all contexts through `snapshot.files(path)`; semantic queries use an explicit project.

`Query.resolvesToSignature` takes declaration selections, retaining their project context rather than accepting bare nodes. Foreign or expired selections are rejected before resolving the candidate call.

Native type and signature objects still come from TypeScript. Their project ownership is not checked. Do not reuse them in another project or snapshot. The structural type walk also has limits for instantiated conditional types; it is not a proof of every reachable public type.

## Reading the code

The dependency order between modules is enforced by the `layers` check in `safemods.config.ts`; a module imports only from the layers before it. `safemods map` prints the live module graph with each file's exports and importer count.

Starting points that `map` does not explain:

- `src/Workspace/ProjectSnapshot.ts` — the interface at the top is every question you can ask the compiler. `perNode` is why asking about thousands of nodes costs one call per file.
- `src/Query/` — a query is an Effect returning `Selection`s (a node plus where it is) in file and position order. `Query.files` scopes a walk to a glob; `where` filters with a compiler question.
- `src/Checks/Layers.ts` — a short real rule. Then `WeakReturns.ts` for one that uses types.
- `src/Migration/` — verify proposals and apply captured results, refusing stale files and symlink escapes.

Verification uses one captured input base for planning, diagnostics and replay. It records compiler file reads, missing paths, directory listings and real paths, including dependencies outside the workspace. It rejects changed observations before returning a verified result and again before application. This is not an atomic filesystem snapshot.

Diagnostics retain their project ID. Their filenames are workspace-relative when possible and absolute for external files, so an existing error in one context cannot mask a new error in another.

Application checks real paths before writing and again near each mutation. Installation uses hard links to avoid overwriting a destination created after preflight. The filesystem must support hard links. Recovery preserves originals and temporary files when it cannot establish ownership, and reports their paths. Cleanup failure after a successful commit is reported separately.

Do not run concurrent writers during application. Portable filesystem operations cannot guarantee safety against a hostile process swapping paths or symlinks between a check and mutation.

## Programmatic migrations

`Migration.verify(recipe, input)` returns `{ preview, unsupported, diagnosticDiff, apply }`. The `apply` field is an Effect that captures the verified changes; there is no separate application function.

The preview is a detached copy. Changing its buffers cannot change the bytes applied. Application also retains the original workspace and platform services, so providing a different workspace later cannot redirect writes.

```ts
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Migration, Workspace } from "safemods"
import removeDebugger from "./recipes/remove-debugger.ts"

export const main = Effect.gen(function* () {
  const definition = yield* Workspace.WorkspaceDefinition.make({
    projects: [{ id: "app", config: "tsconfig.json" }],
  })
  const workspace = Workspace.layer(definition, process.cwd())
  return yield* Effect.gen(function* () {
    const verified = yield* Migration.verify(removeDebugger, undefined)
    return yield* verified.apply
  }).pipe(Effect.provide(Layer.merge(workspace, NodeServices.layer)))
})
```

## Examples

Every recipe in `examples/` except `rename-symbol` and `no-unknown-failures` has a fixture under `fixtures/migrations/<id>/` (`rename-symbol` is a CLI recipe tested in `test/bin.test.ts`; `no-unknown-failures` is a check), and every public export is used by `src/` or an example: `unusedCode` in `safemods.config.ts` counts nothing else as a use. The runner copies the fixture, applies the recipe to the copy, and prints `git diff HEAD`. The original fixture is not written. The fixture's `expected/` tree is the output its migration test asserts (`expectMigration` in `test/utils`); `UPDATE_FIXTURES=1 pnpm test` regenerates it.

```sh
pnpm example rename-package-import
pnpm example --help
```

| ID                          | Migration                                                 |
| --------------------------- | --------------------------------------------------------- |
| `commonjs-to-esm`           | conservative top-level CommonJS → ESM                     |
| `as-assertion-to-satisfies` | safe initializer `as Type` → `satisfies Type`             |
| `rename-package-import`     | `@acme/legacy-client` → `@acme/client`                    |
| `package-entry-point-split` | root package imports → auth and billing entry points      |
| `positional-to-options`     | `createSession(userId, ttl)` → options object             |
| `overloaded-method`         | callback overload → promise/options, with findings        |
| `jsx-button-props`          | migrate `Button` props through aliases and namespaces     |
| `rename-through-barrel`     | `loadAccount` → `findAccount` through barrels and aliases |
| `rename-interface-property` | safely rename a typed interface property and references   |
| `move-module`               | move a module and rewrite relative importers              |
| `split-module`              | split model/service/index and coordinate consumers        |
| `default-to-named`          | default export → named export                             |
| `enum-to-const-object`      | string enum → const object and value union                |
| `relative-js-extensions`    | add `.js` to relative specifiers                          |
| `remove-debugger`           | delete `debugger` statements                              |
| `let-to-const`              | `let` → `const` where no declared name is written again   |
| `void-floating-promises`    | mark a dropped promise with `void`                        |
| `concat-to-template`        | `"a" + b` → template literal for strings and numbers      |
| `object-as-const`           | `as const` on exported all-literal objects                |
| `normalize-line-endings`    | CRLF → LF                                                 |

To add an example, write `examples/<id>.ts`, a fixture at `fixtures/migrations/<id>/` with its `expected/` tree, a test at `test/migrations/<id>.test.ts`, and an `entry(recipe, input)` line in the manifest in `examples/run.ts`. `test/examples-registry.test.ts` fails until all four exist.

## Verifying safemods itself

CI runs on Ubuntu, macOS and Windows with Node 24.

| Command                   | What it proves                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm check:file <paths>` | oxlint and dprint on those files plus project-wide types, about 1.5s; use it after each edit                     |
| `pnpm check:fast`         | formatting, types, oxlint, knip and `safemods check` on itself, all reported in one run, about 3s                |
| `pnpm test:fast`          | the `fast` vitest project; `pnpm test:changed` runs only tests affected by uncommitted changes                   |
| `pnpm check`              | `check:fast` plus the full suite; the local gate for most changes                                                |
| `pnpm coverage`           | the suite covers the in-process source at or above a ratcheted threshold                                         |
| `pnpm mutation`           | injecting faults into core modules still fails the suite, so the tests observe behavior and are not tautological |
| `pnpm check:release`      | the package builds and a packed-package consumer imports it                                                      |
| `pnpm verify`             | `check`, `coverage`, `mutation` and `check:release`; run it before a pull request                                |

CI runs `check`, `check:release`, `coverage` and `mutation`. Coverage excludes the surfaces that only run in a spawned `src/bin.ts` (`bin`, `Config`, `Inspect`, and the example runners `examples/run.ts` and `examples/rename-symbol.ts`); their end-to-end CLI tests still run in `pnpm check`, but V8 reports only the parent process. Every mutant is anchored by a `// mutant: <id>` comment above the line it changes and names the test that must kill it; a surviving mutant fails the run. `pnpm mutation --list` prints the mutants and `--only <id>` runs one.

`pnpm install` points this checkout's git hooks at `.githooks`, so a push runs `pnpm check:fast` and `pnpm test:fast`. Set `SKIP_SAFEMODS_HOOKS=1` to skip it.

Tests mirror the source: `src/X.ts` is tested by `test/X.test.ts` and `src/Dir/Y.ts` by `test/Dir/Y.test.ts`. Cross-cutting tests sit beside them (`test/Pipeline.test.ts`, `test/ProposalSafety.test.ts`, `test/RecipeBoundary.test.ts`), and each example's test is `test/migrations/<id>.test.ts`.

```sh
pnpm install
pnpm check
```
