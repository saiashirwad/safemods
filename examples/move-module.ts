/**
 * Move a module, rewriting every relative import and re-export that points at
 * it, plus the moved module's own relative specifiers.
 */
import { dirname, normalize } from "node:path/posix"
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as ModuleSpecifier from "safemods/ModuleSpecifier"
import type * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface MoveModuleInput {
  readonly project: ConfiguredProject.Type
  readonly from: ProjectRelativePath.Type
  readonly to: ProjectRelativePath.Type
}

const isRelative = ({ value }: Query.Selection<Query.ResolvedModuleReference>): boolean =>
  ModuleSpecifier.parse(value.specifier.text)._tag !== "Package"

const pathNamedBy = (fromFile: string, specifier: string): string =>
  normalize(`${dirname(fromFile)}/${specifier}`)

const sameExtensionAs = (path: string, specifier: string): string => {
  const target = ModuleSpecifier.parse(path)
  const stem = target._tag === "Source" || target._tag === "Runtime" ? target.stem : path
  const written = ModuleSpecifier.parse(specifier)
  return written._tag === "Source" || written._tag === "Runtime" ?
    `${stem}${written.extension}` :
    stem
}

const rewrite =
  (input: MoveModuleInput) =>
  (selection: Query.Selection<Query.ResolvedModuleReference>): ReadonlyArray<Draft.Draft> => {
    const { project, fileName, value } = selection
    const specifier = value.specifier
    const insideMoved = fileName === input.from
    const pointsAtMoved = value.resolved?.fileName === input.from
    if (!insideMoved && !pointsAtMoved) return []

    const from = insideMoved ? input.to : fileName
    const next = pointsAtMoved ?
      sameExtensionAs(ModuleSpecifier.between(from, input.to), specifier.text) :
      ModuleSpecifier.between(from, pathNamedBy(fileName, specifier.text))
    if (next === specifier.text) return []
    return [Draft.replaceStringLiteral(project, specifier, next)]
  }

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
        Query.filter(isRelative),
        Query.collect,
      )

      return Draft.concat(Draft.moveFile(moved, input.to), ...references.flatMap(rewrite(input)))
    }),
})
