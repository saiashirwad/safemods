import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as Policy from "safemods/Policy"
import * as Recipe from "safemods/Recipe"
import { ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

const app = ConfiguredProject.make({ id: "app", config: "tsconfig.json" })

export default Recipe.define("rename-old-name", {
  version: "1.0.0",
  policies: [Policy.matches({ min: 4 }), Policy.noNewErrors(), Policy.idempotent()],
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(app)
      const oldName = yield* project.symbolNamed("oldName", { within: "src/symbol.ts" })
      return yield* Draft.renameSymbol(project, oldName, "increment")
    }),
})
