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

List projects and checks in `safemods.config.ts`:

```ts
import type * as Check from "safemods/Check"
import { noUnknownFailures } from "./checks/no-unknown-failures.ts"

export default {
  projects: [{ id: "app", config: "tsconfig.json" }],
  checks: [noUnknownFailures],
} satisfies Check.Config
```

```sh
safemods check                                         # exit 1 on findings, 2 if the run failed
safemods check --format json
safemods check --baseline known.json --update-baseline # accept what exists today
safemods check --baseline known.json                   # fail only on findings that are new
```

`checks/` holds the checks this repository runs on itself as part of `pnpm lint`: the module order below (`layers`), no function whose resolved return type is `any` or `unknown` (`weak-returns`), and `unsafeNative` kept out of recipes and checks (`restricted-references`).

## Modules

Each module depends only on the ones above it.

| Module                                       | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `Sha256`, `ProjectId`, `ProjectRelativePath` | branded value types                                                  |
| `Edit`                                       | hash-guarded text edits and their application                        |
| `Plan`                                       | the canonical, content-addressed plan: finalize, validate, parse     |
| `Workspace`                                  | compiler snapshots; every snapshot is a fresh view of disk + overlay |
| `Query`, `Type`                              | streams of selected syntax nodes; predicates and parsers over types  |
| `Draft`, `Check`                             | proposed edits and file operations; findings and their baseline      |
| `Recipe`                                     | define a transformation; `run` turns its draft into a plan           |
| `Verification`                               | preview exact bytes, diff diagnostics, replay, issue a verified plan |
| `Application`                                | write a verified plan, refusing stale files and symlink escapes      |
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
