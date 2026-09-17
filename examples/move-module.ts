/**
 * Move a module, rewriting every relative import and re-export that points at
 * it, plus the moved module's own relative specifiers.
 */
import { dirname, normalize, relative } from "node:path/posix"
import { Effect } from "effect"
import { and, or, refineDefinedKey } from "is-kit"
import type { Node, StringLiteral } from "typescript/unstable/ast"
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isImportExpression,
  isImportTypeNode,
  isLiteralTypeNode,
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

const resolve = (fromFile: string, specifier: string): string =>
  normalize(`${dirname(fromFile)}/${specifier}`)

const specifierTo = (fromFile: string, target: string): string => {
  const rel = relative(dirname(fromFile), target)
  return rel.startsWith(".") ? rel : `./${rel}`
}

const isStaticModuleReference = and(
  or(isImportDeclaration, isExportDeclaration),
  refineDefinedKey("moduleSpecifier", isStringLiteral),
)

interface ModuleReference {
  readonly specifier: StringLiteral
}

const moduleReference = (node: Node): ModuleReference | undefined => {
  if (isStaticModuleReference(node)) return { specifier: node.moduleSpecifier }
  if (isCallExpression(node)) {
    const [specifier] = node.arguments
    if (
      isImportExpression(node.expression) &&
      specifier !== undefined &&
      isStringLiteral(specifier)
    ) {
      return { specifier }
    }
  }
  if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
    const specifier = node.argument.literal
    if (isStringLiteral(specifier)) return { specifier }
  }
  return undefined
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

      const pointsAtMoved = (fileName: string, specifier: string): boolean =>
        resolve(fileName, specifier).replace(/\.js$/, ".ts") === input.from

      const specifierAfterMove = (fileName: string, specifier: string): string =>
        specifierTo(
          fileName === input.from ? input.to : fileName,
          pointsAtMoved(fileName, specifier)
            ? input.to.replace(/\.ts$/, ".js")
            : resolve(fileName, specifier),
        )

      const references = yield* Query.nodes(
        project,
        (node): node is Node => moduleReference(node) !== undefined,
      ).pipe(
        Query.filter(({ value, fileName }) => {
          const specifier = moduleReference(value)!.specifier.text
          return (
            specifier.startsWith(".") &&
            (fileName === input.from || pointsAtMoved(fileName, specifier)) &&
            specifierAfterMove(fileName, specifier) !== specifier
          )
        }),
        Query.collect,
      )

      return Draft.concat(
        Draft.moveFile(moved, input.to),
        Draft.concat(
          ...references.map(({ project, value, fileName }) => {
            const specifier = moduleReference(value)!.specifier
            const quote = specifier.getText().startsWith("'") ? "'" : '"'
            const next = specifierAfterMove(fileName, specifier.text)
            return Draft.replace(project, specifier, `${quote}${next}${quote}`)
          }),
        ),
      )
    }),
})
