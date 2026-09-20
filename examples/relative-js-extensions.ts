/**
 * Rewrite relative module specifiers to the form NodeNext resolves. A specifier without a
 * runtime extension is matched against the project's own files, so `./auth` becomes
 * `./auth/index.js` when that is the file it names. Specifiers that name no project file are
 * reported rather than guessed at.
 */
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as ModuleSpecifier from "safemods/ModuleSpecifier"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const rewritable = new Set<Query.ModuleReferenceKind>([
  "import",
  "export",
  "dynamic-import",
  "import-type",
])

const needsRewrite = ({ value }: Query.Selection<Query.ResolvedModuleReference>): boolean => {
  const written = ModuleSpecifier.parse(value.specifier.text)
  return (
    rewritable.has(value.kind) && (written._tag === "Extensionless" || written._tag === "Source")
  )
}

const rewrite =
  (files: ReadonlySet<string>) =>
  (selection: Query.Selection<Query.ResolvedModuleReference>): Draft.Draft => {
    const { specifier, resolved } = selection.value
    const from = selection.fileName
    const target = resolved?.fileName ?? ModuleSpecifier.fileNamedBy(files, from, specifier.text)
    if (target === undefined) {
      return Draft.unsupported(selection, `${specifier.text} names no project file`)
    }
    const next = ModuleSpecifier.emitted(ModuleSpecifier.between(from, target))
    return Draft.replaceStringLiteral(selection.project, specifier, next)
  }

export const relativeJsExtensions = Recipe.define("relative-js-extensions", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Effect.gen(function* () {
          const files = new Set<string>((yield* project.files).map((file) => file.fileName))
          const references = yield* Query.resolvedModuleReferences(project).pipe(
            Query.filter(needsRewrite),
            Query.collect,
          )
          return Draft.concat(...references.map(rewrite(files)))
        }))
      return Draft.concat(...drafts)
    }),
})
