import { describe, effect, expect } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { Type as NativeType } from "typescript/unstable/async"
import * as Query from "../src/Query.ts"
import * as Type from "../src/Type.ts"
import { collectDiagnostics } from "../src/Verification/Diagnostics.ts"
import type { ProjectSnapshot, ProjectSnapshotError } from "../src/Workspace/index.ts"
import { projectPath } from "./utils/domain.ts"
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

const MENTIONS = [
  'import type { Effect } from "effect"',
  'import type { Marker } from "./lookalike.js"',
  'import type { Marker as Real } from "./marker.js"',
  "",
  "export interface Chain {",
  "  readonly next: Chain | undefined",
  "  readonly tag: Real",
  "}",
  "export interface Loop {",
  "  readonly next: Loop | undefined",
  "  readonly label: string",
  "}",
  "export declare const chained: Chain",
  "export declare const looped: Loop",
  "export declare const promised: Promise<Real>",
  "export declare const effected: Effect.Effect<Real, string, never>",
  "export declare const accepts: { run(input: Real): number }",
  "export declare const returns: { run(): Real }",
  "export declare const nested: { readonly inner: { readonly held: Real } }",
  "export declare const external: Promise<string>",
  "export declare const impostor: Marker",
  "export interface Factory {",
  "  new (): Real",
  "}",
  "export interface Keyed {",
  "  readonly [key: string]: Real",
  "}",
  "export declare const factory: Factory",
  "export declare const keyed: Keyed",
  "export declare const intersected: Real & { readonly extra: 1 }",
  "type Phantom<T> = { readonly tag: string; readonly unrelated: T[keyof T] }",
  "export declare const phantom: Phantom<Real>",
  "interface Conditional<T> {",
  "  readonly held: T extends string ? Real : number",
  "}",
  "export declare const conditional: Conditional<string>",
  "type Builder<Out> = {",
  "  onA<B>(f: () => B): Builder<Out | B>",
  "  onB<B>(f: () => B): Builder<Out | B>",
  "  done(): Out",
  "}",
  "export declare const builder: <Out>() => Builder<Out>",
  "type Layered<Out> = { readonly tag: string } & {",
  "  onA<B>(f: () => B): Layered<Out | B>",
  "  done(): Out",
  "}",
  "export declare const layered: <Out>() => Layered<Out>",
  "export declare const constrained: <T extends Real>(value: T) => T",
  "",
].join("\n")

const mentionsProject = <A, E, R>(use: (project: ProjectSnapshot) => Effect.Effect<A, E, R>) =>
  withProject(
    {
      "src/marker.ts": 'export interface Marker { readonly tag: "marker" }\n',
      "src/lookalike.ts": 'export interface Marker { readonly tag: "marker" }\n',
      "src/mentions.ts": MENTIONS,
    },
    use,
    { dependencies: true },
  )

const declaredType = (project: ProjectSnapshot, name: string) =>
  Effect.gen(function* () {
    const [declaration] = yield* Query.identifiers(project).pipe(
      Query.within("src/mentions.ts"),
      Query.filter(({ value }) => value.text === name),
      Query.collect,
    )
    return (yield* project.typeOf(declaration!.value))!
  })

const realMarker = (project: ProjectSnapshot) =>
  Effect.gen(function* () {
    const file = yield* project.file(projectPath("src/marker.ts"))
    const exported = yield* project.exportsOf(file!)
    return exported.find((entry) => entry.name === "Marker")!.symbol
  })

describe("mentions", () => {
  effect("finds a type through generics, members and signatures, and only that type", () =>
    mentionsProject((project) =>
      Effect.gen(function* () {
        const marker = yield* realMarker(project)
        const isMarker = (candidate: NativeType) =>
          Effect.gen(function* () {
            const symbol = yield* project.symbolOfType(candidate)
            return symbol !== undefined && (yield* project.canonicalSymbol(symbol)) === marker
          })
        const found = (name: string) =>
          Effect.gen(function* () {
            const type = yield* declaredType(project, name)
            const mentioned = yield* Type.mentions(project, type, isMarker)
            return Option.isNone(mentioned)
              ? undefined
              : yield* project.typeToString(mentioned.value)
          })

        expect(yield* found("chained")).toBe("Marker")
        expect(yield* found("promised")).toBe("Marker")
        expect(yield* found("effected")).toBe("Marker")
        expect(yield* found("accepts")).toBe("Marker")
        expect(yield* found("returns")).toBe("Marker")
        expect(yield* found("nested")).toBe("Marker")

        expect(yield* found("factory")).toBe("Marker")
        expect(yield* found("keyed")).toBe("Marker")
        expect(yield* found("intersected")).toBe("Marker")
        expect(yield* found("phantom")).toBe("Marker")
        expect(yield* found("constrained")).toBe("Marker")

        expect(yield* found("looped")).toBeUndefined()
        expect(yield* found("external")).toBeUndefined()
        expect(yield* found("impostor")).toBeUndefined()
        expect(yield* found("conditional")).toBeUndefined()
        expect(yield* found("builder")).toBeUndefined()
        expect(yield* found("layered")).toBeUndefined()
      }),
    ),
  )

  effect("walks own members but leaves a type declared outside the project a leaf", () =>
    mentionsProject((project) =>
      Effect.gen(function* () {
        const visited = (name: string) =>
          Effect.gen(function* () {
            const seen: Array<string> = []
            const type = yield* declaredType(project, name)
            yield* Type.mentions(project, type, (candidate) =>
              Effect.map(project.typeToString(candidate), (text) => {
                seen.push(text)
                return false
              }),
            )
            return seen.sort()
          })

        expect(yield* visited("promised")).toEqual([
          '"marker"',
          "Marker",
          "Promise<Marker>",
          "Promise<T>",
          "T",
        ])
        expect(yield* visited("external")).toEqual(["Promise<T>", "Promise<string>", "T", "string"])
        expect(yield* visited("intersected")).toEqual([
          '"marker"',
          "1",
          "Marker",
          "Marker & { readonly extra: 1; }",
          "{ readonly extra: 1; }",
        ])
        expect(yield* visited("nested")).toEqual([
          '"marker"',
          "Marker",
          "{ readonly held: Marker; }",
          "{ readonly inner: { readonly held: Marker; }; }",
        ])
      }),
    ),
  )
})
