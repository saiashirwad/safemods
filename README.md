# safemods

Type-directed codemods for TypeScript 7, built on Effect.

Pre-alpha. Recipes query the checker, emit a draft, then plan → verify → apply. Verification refuses new diagnostics and can require idempotence. Apply writes only a verified plan.

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
      const project = yield* Effect.succeed(snapshot.projects[0]!)
      const symbol = yield* project.symbolNamed("loadAccount", { within: store })
      const matches = yield* Query.identifiers(project).pipe(
        Query.where(Query.resolvesTo(symbol)),
        Query.filter((selection) => selection.value.text === "loadAccount"),
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

## Modules

Each module depends only on the ones above it.

| Module                                       | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `Sha256`, `ProjectId`, `ProjectRelativePath` | branded value types                                                  |
| `Edit`                                       | hash-guarded text edits and their application                        |
| `Plan`                                       | the canonical, content-addressed plan: finalize, validate, parse     |
| `Workspace`                                  | compiler snapshots; every snapshot is a fresh view of disk + overlay |
| `Query`                                      | streams of selected syntax nodes                                     |
| `Draft`                                      | pure values: proposed edits and file operations                      |
| `Recipe`                                     | define a transformation; `run` turns its draft into a plan           |
| `Verification`                               | preview exact bytes, diff diagnostics, replay, issue a verified plan |
| `Application`                                | write a verified plan, refusing stale files and symlink escapes      |

## Examples

Each recipe in `examples/` has a fixture under `fixtures/migrations/`. The runner copies the fixture, applies the recipe to the copy, and prints `git diff HEAD`. The original fixture is not written.

```sh
pnpm example rename-package-import
pnpm example --help
```

| ID                       | Migration                                                 |
| ------------------------ | --------------------------------------------------------- |
| `rename-package-import`  | `@acme/legacy-client` → `@acme/client`                    |
| `positional-to-options`  | `createSession(userId, ttl)` → options object             |
| `rename-through-barrel`  | `loadAccount` → `findAccount` through barrels and aliases |
| `move-module`            | move a module and rewrite relative importers              |
| `default-to-named`       | default export → named export                             |
| `relative-js-extensions` | add `.js` to relative specifiers                          |

Requires Node 24+.

```sh
pnpm install
pnpm check
```
