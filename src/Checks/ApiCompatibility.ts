import { basename, matchesGlob } from "node:path"
import { Effect, Option } from "effect"
import {
  SymbolFlags,
  type Symbol as NativeSymbol,
  type Type as NativeType,
} from "typescript/unstable/async"
import * as Check from "../Check.ts"
import { Comparison, previousMarker } from "../Comparison.ts"
import * as ProjectRelativePath from "../ProjectRelativePath.ts"
import type { ProjectFile, ProjectSnapshot } from "../Workspace/index.ts"
import { declarationIn, typeOf } from "./Exported.ts"

const withoutIds = (printed: string): string =>
  printed.replaceAll(/@\d+/g, "").replaceAll(previousMarker, "")

const ordered = (printed: string): string => printed.split(" | ").sort().join(" | ")

const printedOf = (project: ProjectSnapshot, type: NativeType) =>
  Effect.map(project.typeToString(type, { expandAliases: true }), withoutIds)

const membersOf = (project: ProjectSnapshot, type: NativeType) =>
  Effect.gen(function* () {
    if (!type.isObjectType()) return new Map<string, string>()
    const [properties, indexes] = yield* Effect.all(
      [project.propertiesOf(type), project.indexInfosOf(type)],
      { concurrency: "unbounded" },
    )
    const described = yield* Effect.all(
      [
        Effect.forEach(
          properties,
          (property) =>
            Effect.gen(function* () {
              const memberType = yield* project.typeOfSymbol(property)
              const optional = (property.flags & SymbolFlags.Optional) === 0 ? "" : "optional "
              const printed =
                memberType === undefined ? "unresolved" : yield* project.typeToString(memberType)
              return [withoutIds(property.name), withoutIds(`${optional}${printed}`)] as const
            }),
          { concurrency: "unbounded" },
        ),
        Effect.forEach(
          indexes,
          (index) =>
            Effect.gen(function* () {
              const printed = yield* Effect.all(
                [project.typeToString(index.keyType), project.typeToString(index.valueType)],
                { concurrency: "unbounded" },
              )
              return [`[key: ${withoutIds(printed[0])}]`, withoutIds(printed[1])] as const
            }),
          { concurrency: "unbounded" },
        ),
      ],
      { concurrency: "unbounded" },
    )
    return new Map(described.flat())
  })

const differenceOf = (project: ProjectSnapshot, was: NativeType, now: NativeType) =>
  Effect.gen(function* () {
    const printed = yield* Effect.all([printedOf(project, was), printedOf(project, now)], {
      concurrency: "unbounded",
    })
    if (ordered(printed[0]) !== ordered(printed[1])) {
      return Option.some(`was ${printed[0]}, now ${printed[1]}`)
    }
    const [before, after] = yield* Effect.all([membersOf(project, was), membersOf(project, now)], {
      concurrency: "unbounded",
    })
    const removed = [...before.keys()].filter((name) => !after.has(name)).sort()
    const added = [...after.keys()].filter((name) => !before.has(name)).sort()
    const changed = [...before]
      .filter(([name, type]) => after.has(name) && ordered(after.get(name)!) !== ordered(type))
      .map(([name, type]) => `${name} (was ${type}, now ${after.get(name)!})`)
      .sort()
    const parts = [
      ...(removed.length === 0 ? [] : [`removed ${removed.join(", ")}`]),
      ...(changed.length === 0 ? [] : [`changed ${changed.join(", ")}`]),
      ...(added.length === 0 ? [] : [`added ${added.join(", ")}`]),
    ]
    return parts.length === 0 ? Option.none() : Option.some(parts.join("; "))
  })

const changeIn = (
  project: ProjectSnapshot,
  name: string,
  was: NativeSymbol,
  now: NativeSymbol,
  file: ProjectFile,
) =>
  Effect.gen(function* () {
    const at = yield* declarationIn(project, now, file)
    if (at === undefined) return []
    const types = yield* Effect.all([typeOf(project, was), typeOf(project, now)], {
      concurrency: "unbounded",
    })
    const [wasType, nowType] = types
    if (wasType === undefined || nowType === undefined) return []
    const fits = yield* Effect.all(
      [project.isTypeAssignableTo(nowType, wasType), project.isTypeAssignableTo(wasType, nowType)],
      { concurrency: "unbounded" },
    )
    if (fits[0] && fits[1]) return []
    const difference = yield* differenceOf(project, wasType, nowType)
    if (Option.isNone(difference)) return []
    return [
      Check.report(
        at,
        fits[0]
          ? `widened export ${name}, so old uses still typecheck: ${difference.value}`
          : `breaking change to export ${name}: ${difference.value}`,
      ),
    ]
  })

const removalsFor = (
  project: ProjectSnapshot,
  exported: ReadonlyArray<string>,
  fileName: ProjectRelativePath.Type,
) =>
  exported.map((name) =>
    Check.reportAt(
      project,
      ProjectRelativePath.schema.make(basename(project.project.config)),
      `removed export ${name}, and ${fileName} is gone`,
    ),
  )

const reportsFor = (
  project: ProjectSnapshot,
  before: ProjectFile,
  current: ProjectFile | undefined,
  fileName: ProjectRelativePath.Type,
) =>
  Effect.gen(function* () {
    const was = yield* project.exportsOf(before)
    if (current === undefined) {
      return removalsFor(
        project,
        was.map(({ name }) => name),
        fileName,
      )
    }
    const now = new Map((yield* project.exportsOf(current)).map((entry) => [entry.name, entry]))
    return yield* Check.each(was, ({ name, symbol }) => {
      const found = now.get(name)
      return found === undefined
        ? Effect.succeed([Check.reportAt(project, current.fileName, `removed export ${name}`)])
        : changeIn(project, name, symbol, found.symbol, current)
    })
  })

export const apiCompatibility = (options: { readonly within: string }) =>
  Check.perProject("api-compatibility", (project) =>
    Effect.flatMap(Comparison, ({ previous }) =>
      Check.each(
        [...(previous.get(project.project.id) ?? [])].filter(([fileName]) =>
          matchesGlob(fileName, options.within),
        ),
        ([fileName, before]) =>
          Effect.flatMap(project.file(fileName), (current) =>
            reportsFor(project, before, current, fileName),
          ),
      ),
    ),
  )
