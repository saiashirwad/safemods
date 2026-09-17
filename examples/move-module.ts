import { dirname, normalize, relative } from "node:path/posix"
import { Effect } from "effect"
import { and, or, refineDefinedKey } from "is-kit"
import { SyntaxKind } from "typescript/unstable/ast"
import {
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from "typescript/unstable/ast/is"
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

const isModuleReference = and(
  or(isImportDeclaration, isExportDeclaration),
  refineDefinedKey("moduleSpecifier", isStringLiteral),
)

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

      const references = yield* Query.nodes(project, isModuleReference, [
        SyntaxKind.ImportDeclaration,
        SyntaxKind.ExportDeclaration,
      ]).pipe(
        Query.filter(({ value, fileName }) =>
          resolvesToFile(fileName, value.moduleSpecifier.text, input.from),
        ),
        Query.collect,
      )

      const referenceDraft = yield* Draft.replaceEach(references, ({ value, fileName }) => {
        const specifier = value.moduleSpecifier
        const quote = specifier.getText().startsWith("'") ? "'" : '"'
        return { node: specifier, text: `${quote}${toSpecifier(fileName, input.to)}${quote}` }
      })

      return yield* Draft.concat(moveDraft, referenceDraft)
    }),
})
