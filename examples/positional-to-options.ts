/**
 * Find every function that offers both a positional overload and a single-object overload
 * whose properties carry the same names and accept the same types, then move the positional
 * callers onto the object form. Nothing is named in advance: the overload pairs come from the
 * declarations' shape, the checker confirms each pair, and each call is migrated only when it
 * resolves to the positional overload. Argument trivia is preserved; spreads are reported.
 */
import { Effect } from "effect"
import type { Identifier, NodeArray, ParameterDeclaration } from "typescript/unstable/ast"
import { isFunctionDeclaration, isIdentifier, isSpreadElement } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import * as P from "safemods/Pattern"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, type ProjectSnapshot, WorkspaceSnapshot } from "safemods/Workspace"

export interface PositionalToOptionsInput {
  readonly project: ConfiguredProject.Type
}

const namesOf = (parameters: NodeArray<ParameterDeclaration>): ReadonlyArray<Identifier> =>
  parameters.flatMap(({ name, dotDotDotToken }) =>
    isIdentifier(name) && dotDotDotToken === undefined ? [name] : []
  )

const accepts = (
  project: ProjectSnapshot,
  options: ParameterDeclaration,
  names: ReadonlyArray<Identifier>,
) =>
  Effect.gen(function* () {
    const target = yield* project.typeOf(options)
    if (target === undefined) return false
    const fits = yield* Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const property = yield* project.propertyOf(target, name.text)
        const expected = property === undefined ? undefined : yield* project.typeOfSymbol(property)
        const given = yield* project.typeOf(name)
        return (
          expected !== undefined &&
          given !== undefined &&
          (yield* project.isTypeAssignableTo(given, expected))
        )
      }))
    return fits.every(Boolean)
  })

export const positionalToOptions = Recipe.define("positional-to-options", {
  version: "2.0.0",
  policies: { idempotence: "required" },
  run: (input: PositionalToOptionsInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)

      const overloads = yield* Query.match(project, {
        object: P.node(isFunctionDeclaration, {
          body: undefined,
          name: P.capture("name"),
          parameters: [P.capture("options")],
        }),
        positional: P.node(isFunctionDeclaration, {
          body: undefined,
          name: P.capture("name"),
          parameters: P.capture("parameters"),
        }),
      }).pipe(Query.collect)

      const drafts = yield* Effect.forEach(overloads, (positional) =>
        Effect.gen(function* () {
          if (positional.value._tag !== "positional") return Draft.empty
          const { name, parameters } = positional.value.captures
          const names = namesOf(parameters)
          if (names.length < 2 || names.length !== parameters.length) return Draft.empty

          const objectForms = yield* Effect.filter(overloads, (candidate) =>
            candidate.value._tag === "object" &&
              candidate.fileName === positional.fileName &&
              candidate.value.captures.name.text === name.text ?
              accepts(project, candidate.value.captures.options, names) :
              Effect.succeed(false))
          if (objectForms.length === 0) return Draft.empty

          const calls = yield* Query.calls(project).pipe(
            Query.where(Query.resolvesToSignature([positional.value.node])),
            Query.collect,
          )
          return Draft.concat(
            ...calls.map((selection) => {
              const call = selection.value
              if (call.arguments.some(isSpreadElement)) {
                return Draft.unsupported(selection, "spread arguments hide which name each takes")
              }
              const sourceFile = call.getSourceFile()
              const first = call.arguments[0]
              const last = call.arguments.at(-1)
              if (first === undefined || last === undefined) {
                return Draft.empty
              }
              const properties = call.arguments.map((argument, index) => {
                const key = names[index]!.text
                return argument.getText() === key ? key : `${key}: ${argument.getText()}`
              })
              const before = sourceFile.text.slice(
                call.getStart(sourceFile),
                first.getStart(sourceFile),
              )
              const after = sourceFile.text.slice(last.getEnd(), call.getEnd())
              return Draft.replaceSelection(
                selection,
                `${before}{ ${properties.join(", ")} }${after}`,
              )
            }),
          )
        }))
      return Draft.concat(...drafts)
    }),
})
