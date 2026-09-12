import { dirname, normalize, relative } from "node:path/posix"
import { Effect } from "effect"
import { SyntaxKind } from "typescript/unstable/ast"
import { isExportDeclaration, isStringLiteral } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface MoveModuleInput {
  readonly project: ConfiguredProject
  readonly from: string
  readonly to: string
}

const asSourceFile = (resolved: string): string => resolved.replace(/\.js$/, ".ts")

const resolvesToFile = (fromFile: string, specifier: string, targetFile: string): boolean => {
  if (!specifier.startsWith(".")) return false
  const resolved = normalize(`${dirname(fromFile)}/${specifier}`)
  return asSourceFile(resolved) === targetFile || resolved === targetFile
}

const toSpecifier = (fromFile: string, targetFile: string): string => {
  const rel = relative(dirname(fromFile), targetFile).replace(/\.ts$/, ".js")
  return rel.startsWith(".") ? rel : `./${rel}`
}

export const moveModule = Recipe.define("move-module", {
  version: "1.0.0",
  policies: { matchCount: { min: 1 }, idempotence: "required" },
  run: (input: MoveModuleInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project)

      const source = yield* project.sourceFile(input.from)
      const moveDraft =
        source === undefined ? Draft.empty : yield* Draft.files.move(project, input.from, input.to)

      const importHits = yield* Query.imports(project).pipe(
        Query.filter(
          ({ value, fileName }) =>
            isStringLiteral(value.moduleSpecifier) &&
            resolvesToFile(fileName, value.moduleSpecifier.text, input.from),
        ),
        Query.collect,
      )

      const exportHits = yield* Query.nodes(
        project,
        isExportDeclaration,
        SyntaxKind.ExportDeclaration,
      ).pipe(
        Query.filter(({ value, fileName }) => {
          const specifier = value.moduleSpecifier
          return (
            specifier !== undefined &&
            isStringLiteral(specifier) &&
            resolvesToFile(fileName, specifier.text, input.from)
          )
        }),
        Query.collect,
      )

      const importDraft = yield* Draft.replaceEach(importHits, ({ value, fileName }) => {
        const specifier = value.moduleSpecifier
        if (!isStringLiteral(specifier)) return Draft.empty
        const quote = specifier.getText().startsWith("'") ? "'" : '"'
        return { node: specifier, text: `${quote}${toSpecifier(fileName, input.to)}${quote}` }
      })

      const exportDraft = yield* Draft.replaceEach(exportHits, ({ value, fileName }) => {
        const specifier = value.moduleSpecifier
        if (specifier === undefined || !isStringLiteral(specifier)) return Draft.empty
        const quote = specifier.getText().startsWith("'") ? "'" : '"'
        return { node: specifier, text: `${quote}${toSpecifier(fileName, input.to)}${quote}` }
      })

      return yield* Draft.concat(moveDraft, importDraft, exportDraft)
    }),
})
