import { Effect, Option } from "effect"
import { TypeFlags, type Type as NativeType } from "typescript/unstable/async"
import type { ProjectSnapshot, ProjectSnapshotError } from "./Workspace/index.ts"

export const isAny = (type: NativeType): boolean =>
  (type.flags & TypeFlags.Any) !== 0 && !type.isErrorType()

export const isUnknown = (type: NativeType): boolean => (type.flags & TypeFlags.Unknown) !== 0

export const isNever = (type: NativeType): boolean => (type.flags & TypeFlags.Never) !== 0

type Parameters<Names extends Record<string, string>> = {
  readonly [Name in keyof Names]: NativeType
}

const parameterOf = (
  project: ProjectSnapshot,
  struct: NativeType,
  name: string,
  position: "out" | "in",
): Effect.Effect<Option.Option<NativeType>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const member = yield* project.propertyOf(struct, name)
    const memberType = member === undefined ? undefined : yield* project.typeOfSymbol(member)
    const signatures = memberType === undefined ? [] : yield* project.callSignaturesOf(memberType)
    const [signature] = signatures
    if (signature === undefined || signatures.length > 1) return Option.none()
    return Option.fromUndefinedOr(
      position === "out"
        ? yield* project.returnTypeOf(signature)
        : (yield* project.parameterTypesOf(signature))[0],
    )
  })

export const variance =
  <const Out extends Record<string, string>, const In extends Record<string, string> = {}>(
    typeId: string,
    covariant: Out,
    contravariant?: In,
  ) =>
  (
    project: ProjectSnapshot,
    type: NativeType,
  ): Effect.Effect<Option.Option<Parameters<Out> & Parameters<In>>, ProjectSnapshotError> =>
    Effect.gen(function* () {
      const marker = yield* project.propertyOf(type, typeId)
      const struct = marker === undefined ? undefined : yield* project.typeOfSymbol(marker)
      if (struct === undefined) return Option.none()
      const read = (names: Record<string, string>, position: "out" | "in") =>
        Effect.forEach(
          Object.entries(names),
          ([key, member]) =>
            Effect.map(parameterOf(project, struct, member, position), (found) =>
              Option.map(found, (parameter) => [key, parameter] as const),
            ),
          { concurrency: "unbounded" },
        )
      const found = [
        ...(yield* read(covariant, "out")),
        ...(yield* read(contravariant ?? {}, "in")),
      ]
      return Option.map(
        Option.all(found),
        (entries) => Object.fromEntries(entries) as Parameters<Out> & Parameters<In>,
      )
    })

export const effect = variance("~effect/Effect", { success: "_A", error: "_E", services: "_R" })

export const stream = variance("~effect/Stream", { success: "_A", error: "_E", services: "_R" })

export const layer = variance(
  "~effect/Layer",
  { error: "_E", requirements: "_RIn" },
  { provides: "_ROut" },
)
