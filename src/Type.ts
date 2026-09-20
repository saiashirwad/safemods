import { Effect, Option } from "effect"
import {
  ObjectFlags,
  SymbolFlags,
  type Symbol as NativeSymbol,
  TypeFlags,
  type Type as NativeType,
} from "typescript/unstable/async"
import type { ProjectSnapshot, ProjectSnapshotError } from "./Workspace/index.ts"

export const ofSymbol = (
  project: ProjectSnapshot,
  symbol: NativeSymbol,
): Effect.Effect<NativeType | undefined, ProjectSnapshotError> =>
  (symbol.flags & SymbolFlags.Value) === 0
    ? project.declaredTypeOfSymbol(symbol)
    : project.typeOfSymbol(symbol)

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

const walksInto = (
  project: ProjectSnapshot,
  type: NativeType,
): Effect.Effect<boolean, ProjectSnapshotError> =>
  Effect.gen(function* () {
    if (!type.isObjectType()) return false
    if ((type.objectFlags & ObjectFlags.Anonymous) !== 0) return true
    const symbol = yield* project.symbolOfType(type)
    if (symbol === undefined) return false
    const declared = yield* project.declaredIn(symbol)
    return declared.some((site) => site.fileName !== undefined)
  })

const membersOf = (
  project: ProjectSnapshot,
  type: NativeType,
): Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const [properties, calls, constructs, indexes] = yield* Effect.all(
      [
        project.propertiesOf(type),
        project.callSignaturesOf(type),
        project.constructSignaturesOf(type),
        project.indexInfosOf(type),
      ],
      { concurrency: "unbounded" },
    )
    const propertyTypes = yield* Effect.forEach(
      properties,
      (property) => project.typeOfSymbol(property),
      { concurrency: "unbounded" },
    )
    const signatureTypes = yield* Effect.forEach(
      [...calls, ...constructs],
      (signature) =>
        Effect.all([project.parameterTypesOf(signature), project.returnTypeOf(signature)], {
          concurrency: "unbounded",
        }),
      { concurrency: "unbounded" },
    )
    return [
      ...propertyTypes,
      ...indexes.flatMap((index) => [index.keyType, index.valueType]),
      ...signatureTypes.flatMap(([parameters, returned]) => [...parameters, returned]),
    ].filter((found) => found !== undefined)
  })

const originOf = (
  project: ProjectSnapshot,
  type: NativeType,
  aliased: boolean,
): Effect.Effect<NativeType | undefined, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const target = yield* project.genericTargetOf(type)
    if (target !== undefined) return target
    if (!aliased) return undefined
    const symbol = yield* project.symbolOfType(type)
    if (symbol === undefined) return undefined
    const declared = yield* project.declaredTypeOfSymbol(symbol)
    return declared === type ? undefined : declared
  })

const expansions = new WeakMap<NativeType, ReadonlyArray<NativeType>>()

const expand = (
  project: ProjectSnapshot,
  type: NativeType,
): Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const [typeArguments, aliasTypeArguments] = yield* Effect.all(
      [project.typeArgumentsOf(type), project.aliasTypeArgumentsOf(type)],
      { concurrency: "unbounded" },
    )
    const origin = yield* originOf(project, type, aliasTypeArguments.length !== 0)
    if (origin !== undefined) return [...typeArguments, ...aliasTypeArguments, origin]
    const [union, intersection, constraint] = yield* Effect.all(
      [
        project.unionMembersOf(type),
        project.intersectionMembersOf(type),
        project.constraintOf(type),
      ],
      { concurrency: "unbounded" },
    )
    const members = (yield* walksInto(project, type)) ? yield* membersOf(project, type) : []
    return [
      ...union,
      ...intersection,
      ...typeArguments,
      ...aliasTypeArguments,
      ...(constraint === undefined ? [] : [constraint]),
      ...members,
    ]
  })

const mentionedBy = (
  project: ProjectSnapshot,
  type: NativeType,
): Effect.Effect<ReadonlyArray<NativeType>, ProjectSnapshotError> =>
  Effect.suspend(() => {
    const known = expansions.get(type)
    if (known !== undefined) return Effect.succeed(known)
    return Effect.map(expand(project, type), (mentioned) => {
      expansions.set(type, mentioned)
      return mentioned
    })
  })

export const mentions = <E, R>(
  project: ProjectSnapshot,
  type: NativeType,
  test: (type: NativeType) => Effect.Effect<boolean, E, R>,
): Effect.Effect<Option.Option<NativeType>, E | ProjectSnapshotError, R> =>
  Effect.gen(function* () {
    const visited = new Set<NativeType>()
    let frontier: ReadonlyArray<NativeType> = [type]
    while (frontier.length > 0) {
      const level: Array<NativeType> = []
      for (const candidate of frontier) {
        if (visited.has(candidate)) continue
        visited.add(candidate)
        level.push(candidate)
      }
      const matches = yield* Effect.forEach(level, test, { concurrency: "unbounded" })
      for (const [index, candidate] of level.entries()) {
        if (matches[index] === true) return Option.some(candidate)
      }
      const discovered = yield* Effect.forEach(
        level,
        (candidate) => mentionedBy(project, candidate),
        { concurrency: "unbounded" },
      )
      frontier = discovered.flat()
    }
    return Option.none()
  })
