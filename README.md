# safemods

Type-directed codemods for TypeScript 7, built on Effect.

Pre-alpha. Recipes query the checker, emit a draft, then plan → verify → apply. Verification refuses new diagnostics and can require idempotence. Apply writes only a verified plan.

```ts
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

export const renameThroughBarrel = Recipe.define("rename-through-barrel", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const configured = snapshot.projects[0]
      if (configured === undefined) return Draft.empty
      const project = yield* snapshot.project(configured)
      const symbol = yield* project.symbolNamed("loadAccount", {
        within: "src/accounts/store.ts",
      })
      const matches = yield* Query.identifiers(project).pipe(
        Query.where(Query.resolvesTo(symbol)),
        Query.filter((selection) => selection.value.text === "loadAccount"),
        Query.collect,
      )
      return yield* Draft.replaceEach(matches, () => "findAccount")
    }),
})
```

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
