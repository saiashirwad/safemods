import { Effect, Schema } from "effect"
import { isDebuggerStatement } from "typescript/unstable/ast/is"
import { Check, Migration, Proposal, Query, Recipe, Workspace, WorkspacePath } from "safemods"

export const recipe = Recipe.perProject("remove-debugger", {
  version: "1.0.0",
  run: (project) =>
    Effect.gen(function* () {
      const statements = yield* Query.nodes(project, isDebuggerStatement)
      return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))
    }),
})

const input = Recipe.define("encoded-input", {
  version: "1.0.0",
  schema: Schema.FiniteFromString,
  run: (_snapshot, count) =>
    Effect.succeed(
      Proposal.createFile(
        Schema.decodeUnknownSync(WorkspacePath.schema)("created.ts"),
        `export const count = ${count}`,
      ),
    ),
})

export const migrate = Migration.verify(input, 3).pipe(
  Effect.flatMap((verified) => verified.apply),
)

export const check = Check.perProject(
  "identifiers",
  (project) =>
    Query.identifiers(project).pipe(
      Effect.map((found) => found.map((selection) => Check.report(selection, "identifier"))),
    ),
)

export const program = Workspace.WorkspaceService.use((workspace) =>
  workspace.withSnapshot((snapshot) => recipe.run(snapshot, undefined))
)
