/**
 * Move a module, rewriting every relative import and re-export that points at
 * it, plus the moved module's own relative specifiers.
 */
import { dirname, normalize, relative } from "node:path/posix"
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import type * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface MoveModuleInput {
  readonly project: ConfiguredProject.Type
  readonly from: ProjectRelativePath.Type
  readonly to: ProjectRelativePath.Type
}

const rebase = (fromFile: string, specifier: string): string =>
  normalize(`${dirname(fromFile)}/${specifier}`)

const specifierTo = (fromFile: string, target: string): string => {
  const rel = relative(dirname(fromFile), target)
  return rel.startsWith(".") ? rel : `./${rel}`
}

const extensionOf = (path: string): string => /(?:\.d)?\.[cm]?[jt]sx?$/.exec(path)?.[0] ?? ""

const withoutExtension = (path: string): string =>
  path.slice(0, path.length - extensionOf(path).length)

export const moveModule = Recipe.define("move-module", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: MoveModuleInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const moved = yield* project.file(input.from)
      if (moved === undefined) return Draft.empty

      const references = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(({ value }) => value.specifier.text.startsWith(".")),
        Query.collect,
      )

      return Draft.concat(
        Draft.moveFile(moved, input.to),
        ...references.flatMap(({ project, value, fileName }) => {
          const specifier = value.specifier
          const pointsAtMoved = value.resolved?.fileName === input.from
          if (fileName !== input.from && !pointsAtMoved) return []
          const next = specifierTo(
            fileName === input.from ? input.to : fileName,
            pointsAtMoved
              ? `${withoutExtension(input.to)}${extensionOf(specifier.text)}`
              : rebase(fileName, specifier.text),
          )
          if (next === specifier.text) return []
          const quote = specifier.getText().startsWith("'") ? "'" : '"'
          return [Draft.replace(project, specifier, `${quote}${next}${quote}`)]
        }),
      )
    }),
})
