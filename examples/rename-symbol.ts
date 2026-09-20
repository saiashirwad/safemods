/**
 * Rename the symbol declared as `name` in `file` to `to`, everywhere the compiler says it is used:
 * through barrels, import aliases and JSDoc links. Same-named symbols elsewhere are left alone.
 * Mentions the compiler cannot resolve (prose, @example blocks, strings) are reported, not edited.
 */
import { Array as Arr, Effect, Schema } from "effect"
import type { Node } from "typescript/unstable/ast"
import {
  isIdentifier,
  isShorthandPropertyAssignment,
  isSourceFile,
  isVariableDeclaration,
} from "typescript/unstable/ast/is"
import * as Draft from "../src/Draft.ts"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import { type ProjectSnapshot, WorkspaceSnapshot } from "../src/Workspace/index.ts"

const Input = Schema.Struct({
  file: ProjectRelativePath.schema,
  name: Schema.String,
  to: Schema.String,
})

const at = (fileName: string, start: number): string => `${fileName}:${start}`

const declaresAtTopLevel = (name: Node): boolean => {
  const declaration = name.parent
  if (!("name" in declaration) || declaration.name !== name) return false
  return isSourceFile(
    isVariableDeclaration(declaration) ? declaration.parent.parent.parent : declaration.parent,
  )
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const unresolvedMentions = (
  project: ProjectSnapshot,
  name: string,
  references: ReadonlyArray<Query.Selection<Node>>,
  resolved: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const mention = new RegExp(`\\b${escaped(name)}\\b`, "g")
    const edited = new Set(references.map(({ fileName }) => fileName))
    const files = (yield* project.files).filter(({ fileName }) => edited.has(fileName))
    return Draft.concat(
      ...files.flatMap(({ fileName, sourceFile }) =>
        [...sourceFile.text.matchAll(mention)]
          .filter(({ index }) => !resolved.has(at(fileName, index)))
          .map(({ index }) =>
            Draft.unsupported(
              { value: sourceFile, project, fileName, start: index, end: index + name.length },
              `mentions ${name} in a comment or string the compiler cannot resolve`,
            )
          )
      ),
    )
  })

export const renameSymbol = Recipe.define("rename-symbol", {
  version: "1.0.0",
  schema: Input,
  policies: { idempotence: "required" },
  run: ({ file, name, to }) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Effect.gen(function* () {
          const spelled = yield* Query.identifiers(project).pipe(
            Query.filter(({ value }) => value.text === name),
            Query.collect,
          )
          const declarations = spelled.filter(
            (selection) => selection.fileName === file && declaresAtTopLevel(selection.value),
          )
          const found = yield* Effect.forEach(declarations, (declaration) =>
            Query.referencesTo(declaration).pipe(
              Query.filter(({ value }) => isIdentifier(value) && value.text === name),
              Query.collect,
            ))
          const references = Arr.dedupeWith(
            found.flat(),
            (left, right) =>
              left.fileName === right.fileName && left.start === right.start,
          )
          const resolved = new Set(
            [...spelled, ...references].map(({ fileName, start }) => at(fileName, start)),
          )
          return Draft.concat(
            Draft.replaceEach(references, ({ value }) =>
              isShorthandPropertyAssignment(value.parent) ? `${name}: ${to}` : to),
            yield* unresolvedMentions(project, name, references, resolved),
          )
        }))
      return Draft.concat(...drafts)
    }),
})
