# safemods

Type-directed codemods for TypeScript 7, built on Effect.

Pre-alpha. Two things run on the same compiler snapshot:

- **Recipes** query the checker, emit a draft, then plan → verify → apply. Verification refuses new diagnostics and can require idempotence. Apply writes only a verified plan.
- **Checks** query the checker and report findings. `safemods check` prints them as `path:line:column check message` and exits non-zero, so a coding agent gets a precise rejection without anyone spending tokens on it.

```ts
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const store = ProjectRelativePath.schema.make("src/accounts/store.ts")

export const renameThroughBarrel = Recipe.define("rename-through-barrel", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]!
      const symbol = yield* project.symbolNamed("loadAccount", { within: store })
      const matches = yield* Query.identifiers(project).pipe(
        Query.filter((selection) => selection.value.text === "loadAccount"),
        Query.where(Query.resolvesTo(symbol)),
        Query.collect,
      )
      return Draft.replaceEach(matches, () => "findAccount")
    }),
})
```

Run it against a workspace:

```ts
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { applyVerifiedPlan } from "safemods/Application"
import * as Recipe from "safemods/Recipe"
import { verify } from "safemods/Verification"
import * as Workspace from "safemods/Workspace"

const migrate = Effect.gen(function* () {
  const plan = yield* Recipe.run(renameThroughBarrel, undefined)
  const verified = yield* verify(plan, renameThroughBarrel, undefined)
  return yield* applyVerifiedPlan(verified)
})

export const main = Effect.gen(function* () {
  const definition = yield* Workspace.WorkspaceDefinition.make({
    projects: [{ id: "app", config: "tsconfig.json" }],
  })
  const workspace = Workspace.layer(definition, process.cwd())
  return yield* migrate.pipe(Effect.provide(Layer.merge(workspace, NodeServices.layer)))
})
```

Cheap syntactic filters go first. `Query.where` asks the checker, and questions asked about many nodes at once are sent as one request per file.

## Checks

A check is an Effect that returns reports. Questions about types go through the project snapshot, and `Type` reads Effect, Stream and Layer parameters off their variance structs.

```ts
import { Effect, Option } from "effect"
import * as Check from "safemods/Check"
import * as Query from "safemods/Query"
import * as Type from "safemods/Type"
import { WorkspaceSnapshot } from "safemods/Workspace"

export const noUnknownFailures = Check.define(
  "no-unknown-failures",
  Effect.gen(function* () {
    const snapshot = yield* WorkspaceSnapshot
    const project = snapshot.projects[0]!
    const failing = yield* Query.calls(project).pipe(
      Query.typed,
      Query.where(({ value }) =>
        Effect.map(
          Type.effect(project, value.type),
          (parsed) => Option.isSome(parsed) && Type.isUnknown(parsed.value.error),
        ),
      ),
      Query.collect,
    )
    return failing.map((call) => Check.report(call, "this Effect can fail with unknown"))
  }),
)
```

List projects and checks in `safemods.config.ts`. The rules that ship with the package come from `safemods/Checks`; a rule of your own is a file in your repository.

```ts
import type * as Check from "safemods/Check"
import { apiCompatibility, layers } from "safemods/Checks"
import { noUnknownFailures } from "./checks/no-unknown-failures.ts"

export default {
  projects: [{ id: "app", config: "tsconfig.json" }],
  checks: [
    layers({ within: "src/**", order: [["src/core.ts"], ["src/app.ts"]] }),
    noUnknownFailures,
  ],
  comparisons: [apiCompatibility({ within: "src/**" })],
} satisfies Check.Config
```

```sh
safemods check                                         # exit 1 on findings, 2 if the run failed
safemods check --format json
safemods check --baseline known.json --update-baseline # accept what exists today
safemods check --baseline known.json                   # fail only on findings that are new
safemods check --since main                            # fail only on findings this change added
```

`--since <ref>` needs no baseline file. It runs the checks twice on the same disk: once over the world as it was at the ref — every file that differs gets its text from `git show`, files added since are hidden, files deleted since come back — and once over the world as it is, then reports what the second run found and the first did not. The working tree is compared, so uncommitted and untracked edits count. `--since` and `--baseline` together are refused.

A check listed under `comparisons` sees both versions at once. `--since` gives it one snapshot holding the current world plus the previous text of each changed file, and the `Comparison` service maps each changed file to that previous version as an ordinary `ProjectFile`. One checker answers questions about both, so types from the two versions can be compared directly. Those findings describe the change itself, so they are reported as they are. Without `--since` there is nothing to compare: the CLI skips them and names them on stderr.

### Rules that ship in `safemods/Checks`

| Rule                       | Reports                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `layers`                   | an import that points at a module listed below the importer; an entry ending in `/` is a folder                                                        |
| `weakReturns`              | a function whose resolved return type is `any` or `unknown`, seen through unions, promises and an Effect's success channel                             |
| `restrictedReferences`     | a use of one declaration outside the files allowed to use it, through any alias or re-export                                                           |
| `typeBoundaries`           | an export whose type mentions a type declared in a forbidden file or package, even with no import of it                                                |
| `apiCompatibility`         | a comparison: an export that was removed, or whose type no longer fits where the old one did (`breaking`), or only accepts more (`widened`)            |
| `unjustifiedCasts`         | an `as` the checker cannot confirm: from `any` or `unknown`, a narrowing, or between unrelated types; a cast that was already assignable is left alone |
| `unusedCode`               | an export outside the public API that nothing uses, or that only tests use                                                                             |
| `unusedOptionalParameters` | an optional parameter no caller passes; silent when the function is used other than by calling it, since not every caller is visible then              |
| `ignoredReturns`           | a function whose return value every caller drops                                                                                                       |
| `duplicatedFunctions`      | the same function body written out in more than one file                                                                                               |
| `importCycles`             | an import that leads back to its own file; `typeImports` decides whether `import type` edges count                                                     |
| `oversized`                | a function over a line or parameter limit, a file over a line limit                                                                                    |
| `anyInPublicApi`           | a public export whose type contains `any`, followed through namespace re-exports                                                                       |
| `suppressions`             | `@ts-ignore`, `@ts-expect-error`, lint-disable comments and `!` assertions                                                                             |

`apiCompatibility` stays quiet about an export whose own printed shape is unchanged: that is ripple from a type it mentions, and the type itself is reported. For an interface the message names the members that were removed, changed and added. It cannot see a change confined to a call signature or to a class's instance members.

This repository runs all of them on itself in `pnpm lint` (see `safemods.config.ts`), against the six deliberate casts recorded in `safemods.known.json`, and runs `apiCompatibility` with `pnpm safemods check --since main`.

## Asking the compiler

The same config answers questions, for a person or an agent that would otherwise grep and read files:

```sh
safemods map                         # every file: lines, exports, how many files import it
safemods deps src/Query.ts           # what it imports and what imports it
safemods exports src/Query.ts        # its exports with their types
safemods type src/Query.ts:279:14    # the type and declaration of what is there
safemods refs src/Query.ts:279:14    # every reference, through aliases and re-exports
safemods calls src/Query.ts:279:14   # every direct call, and whether other uses exist
```

## Reading the code

Read in this order; each step uses only what came before.

1. `src/Workspace/ProjectSnapshot.ts` — the interface at the top is every question you can ask the compiler. `perNode` is why asking about thousands of nodes costs one call per file.
2. `src/Query.ts` — a query is a stream of `Selection`s (a node plus where it is). `where` filters with a compiler question.
3. `src/Check.ts` — a check is a name and an Effect returning reports; `run` turns reports into `path:line:column` findings.
4. `src/Checks/Layers.ts` — the smallest real rule, thirty lines. Then `WeakReturns.ts` for one that uses types.
5. `src/bin.ts` — the command: load the config, run the checks, compare with a baseline or a ref, set the exit code.
6. `src/Comparison.ts` and `src/Git.ts` — only needed for `--since`.
7. `src/Draft.ts`, `src/Recipe.ts`, `src/Plan.ts`, `src/Verification/`, `src/Application.ts` — the codemod half, in the order a recipe flows through them.

## Modules

Each module depends only on the ones above it.

| Module                                       | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `Sha256`, `ProjectId`, `ProjectRelativePath` | branded value types                                                  |
| `Git`                                        | the files a ref differs from and their text at it                    |
| `Position`, `ModuleSpecifier`                | line and column of an offset; parse, relate and emit specifiers      |
| `Edit`                                       | hash-guarded text edits and their application                        |
| `Plan`                                       | the canonical, content-addressed plan: finalize, validate, parse     |
| `Workspace`                                  | compiler snapshots; every snapshot is a fresh view of disk + overlay |
| `Pattern`                                    | syntax shapes with typed captures, combined into tagged matches      |
| `Query`, `Type`                              | streams of selected syntax nodes; predicates and parsers over types  |
| `Comparison`                                 | a snapshot holding the previous version of each changed file         |
| `Draft`, `Check`                             | proposed edits and file operations; findings and their baseline      |
| `Checks`                                     | the rules that ship with the package                                 |
| `Recipe`                                     | define a transformation; `run` turns its draft into a plan           |
| `Verification`                               | preview exact bytes, diff diagnostics, replay, issue a verified plan |
| `Application`                                | write a verified plan, refusing stale files and symlink escapes      |
| `Inspect`                                    | answers for `map`, `deps`, `exports`, `type`, `refs` and `calls`     |
| `bin`                                        | the `safemods` command                                               |

Application checks real paths immediately before each mutation. The portable filesystem API does not offer directory handles or atomic no-follow operations, so this confines normal symlink layouts but cannot guarantee safety against a hostile process swapping symlinks between a check and mutation.

## Examples

Each recipe in `examples/` has a fixture under `fixtures/migrations/`. The runner copies the fixture, applies the recipe to the copy, and prints `git diff HEAD`. The original fixture is not written.

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

Requires Node 24+.

```sh
pnpm install
pnpm check
```
