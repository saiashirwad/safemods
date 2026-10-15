import { Effect, Option } from "effect"
import type { Node } from "typescript/unstable/ast"
import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isMethodDeclaration,
} from "typescript/unstable/ast/is"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Check from "../Check.ts"
import * as Query from "../Query/index.ts"
import * as Type from "../Type.ts"
import type { ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"

const isFunctionLike = (node: Node): node is Node =>
  isFunctionDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node)

const isWeak = (
  project: ProjectSnapshot,
  type: NativeType,
): Effect.Effect<boolean, ProjectSnapshotError> =>
  Effect.gen(function* () {
    if (Type.isAny(type) || Type.isUnknown(type)) return true
    const members = yield* project.unionMembersOf(type)
    if (members.length > 1) {
      const weak = yield* Effect.forEach(members, (member) => isWeak(project, member), {
        concurrency: "unbounded",
      })
      return weak.some(Boolean)
    }
    const effect = yield* Type.effect(project, type)
    if (Option.isSome(effect)) return yield* isWeak(project, effect.value.success)
    const [awaited, ...others] = yield* project.typeArgumentsOf(type)
    const thenable = (yield* project.propertyOf(type, "then")) !== undefined
    return thenable && awaited !== undefined && others.length === 0 ?
      yield* isWeak(project, awaited) :
      false
  })

export const weakReturns = (options: { readonly within: string }) =>
  Check.perProject("weak-returns", (project) =>
    Query.files(project, [options.within]).pipe(
      Effect.flatMap((files) => Query.nodes(files, isFunctionLike)),
      Effect.flatMap((functions) =>
        Check.each(functions, (selection) =>
          Effect.gen(function* () {
            const signature = yield* project.signatureOf(selection.value)
            const returned = signature === undefined ?
              undefined :
              yield* project.returnTypeOf(signature)
            if (returned === undefined || !(yield* isWeak(project, returned))) return []
            const printed = yield* project.typeToString(returned)
            return [
              Check.report(
                selection,
                `returns ${printed}: return a named type that says what it holds`,
              ),
            ]
          }))
      ),
    ))
