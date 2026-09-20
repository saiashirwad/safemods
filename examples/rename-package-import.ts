import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const FROM_PACKAGE = "@acme/legacy-client"
const TO_PACKAGE = "@acme/client"

export const renamePackageImport = Recipe.define("rename-package-import", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = snapshot.projects[0]
      if (project === undefined) {
        return Draft.empty
      }

      const references = yield* Query.moduleReferences(project).pipe(
        Query.filter(({ value }) => value.specifier.text === FROM_PACKAGE),
        Query.collect,
      )

      return Draft.concat(
        ...references.map(({ project, value }) =>
          Draft.replaceStringLiteral(project, value.specifier, TO_PACKAGE),
        ),
      )
    }),
})
