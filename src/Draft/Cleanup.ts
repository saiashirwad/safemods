import { Effect } from "effect"
import { isNamedImports } from "typescript/unstable/ast/is"
import { editsConflict } from "../Edit/index.ts"
import type { DraftEvidenceConflict } from "../Evidence/index.ts"
import * as Query from "../Query/index.ts"
import type { ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"
import { imports as draftImports } from "./Imports.ts"
import { concat, empty, type Draft } from "./Draft.ts"

/** Clean up named imports that have no references beyond their own import specifier. */
export const cleanUnused = (
  project: ProjectSnapshot,
): Effect.Effect<Draft, ProjectSnapshotError | DraftEvidenceConflict> =>
  Effect.gen(function* () {
    let accumulated = empty
    const declarations = yield* Query.imports(project).pipe(Query.collect)
    const filesByPath = new Map((yield* project.files).map((file) => [file.path, file]))

    for (const selection of declarations) {
      const statement = selection.value
      const namedBindings = statement.importClause?.namedBindings
      if (namedBindings === undefined || !isNamedImports(namedBindings)) continue
      const projectFile = filesByPath.get(selection.fileName)
      if (projectFile === undefined) continue

      const sourceFile = statement.getSourceFile()
      for (const element of namedBindings.elements) {
        const symbol = yield* project.symbolAt(
          selection.fileName,
          element.name.getStart(sourceFile),
        )
        if (symbol === undefined) continue

        const references = yield* Query.referencesTo(projectFile, symbol).pipe(Query.collect)
        if (references.length > 1) continue

        const draft = yield* draftImports.removeNamed(project, statement, element.name.text)
        const conflicts = draft.edits.some((candidate) =>
          accumulated.edits.some((existing) => editsConflict(candidate, existing)),
        )
        if (!conflicts) accumulated = yield* concat(accumulated, draft)
      }
    }

    return accumulated
  })
