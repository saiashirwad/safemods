/**
 * loadAccount is now findAccount. Rewrites the declaration, barrel re-exports,
 * import aliases, and call sites that still spell the old public name.
 */
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const DECLARATION_FILE = ProjectRelativePath.schema.make("src/accounts/store.ts")

export const renameThroughBarrel = Recipe.define("rename-through-barrel", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const configured = snapshot.projects[0]
      if (configured === undefined) {
        return Draft.empty
      }
      const project = yield* snapshot.project(configured)

      const spelledInDeclaration = yield* Query.identifiers(project).pipe(
        Query.within(DECLARATION_FILE),
        Query.filter((selection) => selection.value.text === "loadAccount"),
        Query.collect,
      )
      if (spelledInDeclaration.length === 0) {
        return Draft.empty
      }

      const symbol = yield* project.symbolNamed("loadAccount", { within: DECLARATION_FILE })
      const matches = yield* Query.identifiers(project).pipe(
        Query.where(Query.resolvesTo(symbol)),
        Query.filter((selection) => selection.value.text === "loadAccount"),
        Query.collect,
      )

      return yield* Draft.replaceEach(matches, () => "findAccount")
    }),
})
