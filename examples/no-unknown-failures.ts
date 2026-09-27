/**
 * Report a call that returns an Effect, Stream or Layer whose failure is `unknown`: whoever
 * handles it cannot tell what went wrong without inspecting the value.
 */
import { Effect, Option } from "effect"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Check from "safemods/Check"
import * as Query from "safemods/Query"
import * as Type from "safemods/Type"
import type { ProjectSnapshot } from "safemods/Workspace"

const failureOf = (project: ProjectSnapshot, type: NativeType) =>
  Effect.gen(function* () {
    const effect = yield* Type.effect(project, type)
    if (Option.isSome(effect)) return Option.some({ kind: "an Effect", error: effect.value.error })
    const stream = yield* Type.stream(project, type)
    if (Option.isSome(stream)) return Option.some({ kind: "a Stream", error: stream.value.error })
    const layer = yield* Type.layer(project, type)
    if (Option.isSome(layer)) return Option.some({ kind: "a Layer", error: layer.value.error })
    return Option.none()
  })

export const noUnknownFailures = (options: { readonly within: string }) =>
  Check.perProject("no-unknown-failures", (project) =>
    Query.calls(project).pipe(
      Query.within(options.within),
      Query.typed,
      Effect.flatMap((calls) =>
        Check.each(calls, (call) =>
          Effect.map(failureOf(project, call.value.type), (failure) =>
            Option.toArray(failure)
              .filter(({ error }) =>
                Type.isUnknown(error)
              )
              .map(({ kind }) =>
                Check.report(
                  call,
                  `returns ${kind} that can fail with unknown: give the failure a type`,
                )
              )))
      ),
    ))
