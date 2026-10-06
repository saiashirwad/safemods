import { Proposal, Query, Recipe } from "safemods"
import { Effect } from "effect"

const FROM_PACKAGE = "@acme/legacy-client"
const TO_PACKAGE = "@acme/client"

export const renamePackageImport = Recipe.define("rename-package-import", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (snapshot) =>
    Effect.gen(function* () {
      const project = snapshot.projects[0]
      if (project === undefined) {
        return Proposal.empty
      }

      const references = yield* Query.moduleReferences(project).pipe(
        Query.filter(({ value }) => value.specifier.text === FROM_PACKAGE),
      )

      return Proposal.concat(
        ...references.map(({ project, value }) =>
          Proposal.replaceStringLiteral(project, value.specifier, TO_PACKAGE)
        ),
      )
    }),
})

export default renamePackageImport
