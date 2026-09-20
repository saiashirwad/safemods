import { matchesGlob } from "node:path"
import { Effect, Option } from "effect"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Check from "../Check.ts"
import * as Type from "../Type.ts"
import {
  type DeclarationSite,
  type ProjectFile,
  type ProjectSnapshot,
  type ProjectSnapshotError,
  WorkspaceSnapshot,
} from "../Workspace/index.ts"
import { declarationIn, typeOf } from "./Exported.ts"

interface Forbidden {
  readonly files?: ReadonlyArray<string> | undefined
  readonly packages?: ReadonlyArray<string> | undefined
}

const placeOf = (forbidden: Forbidden, site: DeclarationSite): string | undefined => {
  const fileName = site.fileName
  if (fileName !== undefined) {
    return forbidden.files?.some((pattern) => matchesGlob(fileName, pattern)) === true
      ? fileName
      : undefined
  }
  const inPackage = forbidden.packages?.find((name) => site.path.includes(`/node_modules/${name}/`))
  return inPackage === undefined
    ? undefined
    : site.path.slice(site.path.lastIndexOf("/node_modules/") + 1)
}

const forbiddenPlace = (
  project: ProjectSnapshot,
  forbidden: Forbidden,
  type: NativeType,
): Effect.Effect<Option.Option<string>, ProjectSnapshotError> =>
  Effect.gen(function* () {
    const symbol = yield* project.symbolOfType(type)
    if (symbol === undefined) return Option.none()
    const declared = yield* project.declaredIn(symbol)
    const place = declared
      .map((site) => placeOf(forbidden, site))
      .find((found) => found !== undefined)
    return Option.map(
      Option.fromUndefinedOr(place),
      (found) => `${symbol.name}, declared in ${found}`,
    )
  })

type Place = (type: NativeType) => Effect.Effect<Option.Option<string>, ProjectSnapshotError>

const memoized = (project: ProjectSnapshot, forbidden: Forbidden): Place => {
  const known = new Map<NativeType, Option.Option<string>>()
  return (type) =>
    Effect.gen(function* () {
      const found = known.get(type)
      if (found !== undefined) return found
      const place = yield* forbiddenPlace(project, forbidden, type)
      known.set(type, place)
      return place
    })
}

const reportsIn = (project: ProjectSnapshot, file: ProjectFile, place: Place) =>
  Effect.gen(function* () {
    const exported = yield* project.exportsOf(file)
    const reports = yield* Effect.forEach(
      exported,
      ({ name, symbol }) =>
        Effect.gen(function* () {
          const at = yield* declarationIn(project, symbol, file)
          if (at === undefined) return []
          const type = yield* typeOf(project, symbol)
          if (type === undefined) return []
          const leaked = yield* Type.mentions(project, type, (candidate) =>
            Effect.map(place(candidate), Option.isSome),
          )
          if (Option.isNone(leaked)) return []
          const described = yield* place(leaked.value)
          return Option.toArray(described).map((found) =>
            Check.report(at, `exports ${name} with a type mentioning ${found}`),
          )
        }),
      { concurrency: 8 },
    )
    return reports.flat()
  })

export const typeBoundaries = (options: {
  readonly within: string
  readonly forbidden: Forbidden
}) =>
  Check.define(
    "type-boundaries",
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const reports = yield* Effect.forEach(snapshot.projects, (project) =>
        Effect.gen(function* () {
          const files = (yield* project.files).filter((file) =>
            matchesGlob(file.fileName, options.within),
          )
          const place = memoized(project, options.forbidden)
          return yield* Effect.forEach(files, (file) => reportsIn(project, file, place), {
            concurrency: 8,
          })
        }),
      )
      return reports.flat(2)
    }),
  )
