/**
 * loadAccount is now findAccount. Rewrites the declaration, barrel re-exports,
 * import aliases, and call sites that still spell the old public name.
 */
import { Proposal, WorkspacePath, Query, Recipe } from "safemods"
import { Effect } from "effect"

const DECLARATION_FILE = WorkspacePath.schema.make("src/accounts/store.ts")

export const renameThroughBarrel = Recipe.define("rename-through-barrel", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot) =>
    Effect.gen(function* () {
      const project = snapshot.projects[0]
      if (project === undefined) {
        return Proposal.empty
      }

      const spelledInDeclaration = yield* Query.identifiers(project).pipe(
        Query.within(DECLARATION_FILE),
        Query.filter((selection) => selection.value.text === "loadAccount"),
      )
      if (spelledInDeclaration.length === 0) {
        return Proposal.empty
      }

      const symbol = yield* project.symbolNamed("loadAccount", { within: DECLARATION_FILE })
      const matches = yield* Query.identifiers(project).pipe(
        Query.filter((selection) => selection.value.text === "loadAccount"),
        Query.where(Query.resolvesTo(symbol)),
      )

      return Proposal.replaceEach(matches, () => "findAccount")
    }),
})

export default renameThroughBarrel
