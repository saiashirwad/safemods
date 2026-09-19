import { describe, effect, expect } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Query from "../src/Query.ts"
import * as Type from "../src/Type.ts"
import { collectDiagnostics } from "../src/Verification/Diagnostics.ts"
import type { ProjectSnapshot, ProjectSnapshotError } from "../src/Workspace/index.ts"
import { withProject } from "./utils/fixture.ts"

const SOURCE = [
  'import { Context, Data, Effect, Layer, Stream } from "effect"',
  "",
  'class Boom extends Data.TaggedError("Boom")<{}> {}',
  'class Clock extends Context.Service<Clock, { readonly now: number }>()("app/Clock") {}',
  "type Timed<A> = Effect.Effect<A, Boom, Clock>",
  "",
  "export const viaAlias: Timed<string> = Effect.fail(new Boom())",
  "export const inferred = Effect.gen(function* () {",
  "  return (yield* Clock).now",
  "})",
  "export const ticks = Stream.make(1, 2, 3)",
  "export const clockLive = Layer.succeed(Clock, { now: 0 })",
  'export const looksLikeOne = { "~effect/Effect": "not a variance struct" }',
  "export const plain = 1",
  'export const parsed = JSON.parse("1")',
  "export const opaque: unknown = 1",
  "",
].join("\n")

const typeNamed = (project: ProjectSnapshot, name: string) =>
  Effect.gen(function* () {
    const [declaration] = yield* Query.identifiers(project).pipe(
      Query.within("src/effects.ts"),
      Query.filter(({ value }) => value.text === name),
      Query.collect,
    )
    return (yield* project.typeOf(declaration!.value))!
  })

const printed = (project: ProjectSnapshot, parameters: Option.Option<Record<string, NativeType>>) =>
  Option.match(parameters, {
    onNone: () => Effect.succeed(undefined),
    onSome: (found) =>
      Effect.map(
        Effect.forEach(Object.entries(found), ([key, type]) =>
          Effect.map(project.typeToString(type), (text) => [key, text] as const),
        ),
        Object.fromEntries,
      ),
  })

describe("types", () => {
  effect("reads Effect, Stream and Layer parameters off the real variance structs", () =>
    withProject(
      { "src/effects.ts": SOURCE },
      (project) =>
        Effect.gen(function* () {
          const parse =
            <Parsed extends Record<string, NativeType>>(
              parser: (
                project: ProjectSnapshot,
                type: NativeType,
              ) => Effect.Effect<Option.Option<Parsed>, ProjectSnapshotError>,
            ) =>
            (name: string) =>
              Effect.flatMap(typeNamed(project, name), (type) =>
                Effect.flatMap(parser(project, type), (found) => printed(project, found)),
              )

          const diagnostics = yield* collectDiagnostics
          expect(
            diagnostics.filter(({ fileName }) => fileName?.endsWith("src/effects.ts") === true),
          ).toEqual([])

          expect(yield* parse(Type.effect)("viaAlias")).toEqual({
            success: "string",
            error: "Boom",
            services: "Clock",
          })
          expect(yield* parse(Type.effect)("inferred")).toEqual({
            success: "number",
            error: "never",
            services: "Clock",
          })
          expect(yield* parse(Type.stream)("ticks")).toEqual({
            success: "1 | 2 | 3",
            error: "never",
            services: "never",
          })
          expect(yield* parse(Type.layer)("clockLive")).toEqual({
            provides: "Clock",
            error: "never",
            requirements: "never",
          })

          expect(yield* parse(Type.effect)("ticks")).toBeUndefined()
          expect(yield* parse(Type.effect)("looksLikeOne")).toBeUndefined()
          expect(yield* parse(Type.effect)("plain")).toBeUndefined()
        }),
      { dependencies: true },
    ),
  )

  effect("tells any and unknown apart from each other and from unresolved types", () =>
    withProject(
      { "src/effects.ts": `${SOURCE}export const unresolved = missingName\n` },
      (project) =>
        Effect.gen(function* () {
          const flags = (name: string) =>
            Effect.map(typeNamed(project, name), (type) => ({
              any: Type.isAny(type),
              unknown: Type.isUnknown(type),
            }))
          expect(yield* flags("parsed")).toEqual({ any: true, unknown: false })
          expect(yield* flags("opaque")).toEqual({ any: false, unknown: true })
          expect(yield* flags("plain")).toEqual({ any: false, unknown: false })
          expect(yield* flags("unresolved")).toEqual({ any: false, unknown: false })
        }),
      { dependencies: true },
    ),
  )
})
