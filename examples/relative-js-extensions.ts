/**
 * Rewrite relative module specifiers to the form NodeNext resolves. A specifier without a
 * runtime extension is matched against the project's own files, so `./auth` becomes
 * `./auth/index.js` when that is the file it names. Specifiers that name no project file are
 * reported rather than guessed at.
 */
import { Proposal, ModuleSpecifier, Query, Recipe } from "safemods"
import { Effect } from "effect"

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
  (selection: Query.Selection<Query.ResolvedModuleReference>): Proposal.Proposal => {
    const { specifier, resolved } = selection.value
    const from = selection.fileName
    const target = resolved?.fileName ?? ModuleSpecifier.fileNamedBy(files, from, specifier.text)
    if (target === undefined) {
      return Proposal.unsupported(selection, `${specifier.text} names no project file`)
    }
    const next = ModuleSpecifier.emitted(ModuleSpecifier.between(from, target))
    return Proposal.replaceStringLiteral(selection.project, specifier, next)
  }

export const relativeJsExtensions = Recipe.perProject("relative-js-extensions", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (project) =>
    Effect.gen(function* () {
      const files = new Set<string>((yield* project.files).map((file) => file.fileName))
      const references = yield* Query.resolvedModuleReferences(project).pipe(
        Query.filter(needsRewrite),
      )
      return Proposal.concat(...references.map(rewrite(files)))
    }),
})

export default relativeJsExtensions
