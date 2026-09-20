import { Effect } from "effect"
import { isAsExpression } from "typescript/unstable/ast/is"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import * as Type from "../Type.ts"

const brief = (printed: string): string =>
  printed.length > 60 ? `${printed.slice(0, 57)}...` : printed

const isUntyped = (type: NativeType): boolean => Type.isAny(type) || Type.isUnknown(type)

export const unjustifiedCasts = (options: { readonly within: string }) =>
  Check.perProject("unjustified-casts", (project) =>
    Query.nodes(project, isAsExpression).pipe(
      Query.within(options.within),
      Query.filter(({ value }) => value.type.getText() !== "const"),
      Query.collect,
      Effect.flatMap((casts) =>
        Check.each(casts, (cast) =>
          Effect.gen(function* () {
            const from = yield* project.typeOf(cast.value.expression)
            const to = yield* project.typeOf(cast.value)
            if (from === undefined || to === undefined) return []
            if (isUntyped(from) ? isUntyped(to) : yield* project.isTypeAssignableTo(from, to)) {
              return []
            }
            const source = brief(yield* project.typeToString(from))
            const target = brief(yield* project.typeToString(to))
            const message = isUntyped(from)
              ? `asserts ${source} as ${target} without checking it: decode or narrow the value instead`
              : (yield* project.isTypeAssignableTo(to, from))
                ? `narrows ${source} to ${target} on trust: use a guard, or give the source the narrower type`
                : `asserts ${source} as the unrelated type ${target}: the value is not what its type says`
            return [Check.report(cast, message)]
          }),
        ),
      ),
    ),
  )
