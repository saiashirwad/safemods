import { Data, Effect, type Layer, Path, Predicate, Schema } from "effect"
import type * as Check from "./Check.ts"
import * as Workspace from "./Workspace/index.ts"

export interface Config {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly config: string }>
  readonly checks: ReadonlyArray<Check.Check<unknown>>
}

export class InvalidConfig extends Data.TaggedError("InvalidConfig")<{
  readonly path: string
  readonly cause: unknown
}> {}

export const importModule = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const absolute = path.resolve(file)
    const url = yield* path.toFileUrl(absolute)
    return yield* Effect.tryPromise({
      try: () => import(url.href) as Promise<Readonly<Record<string, unknown>>>,
      catch: (cause) => new InvalidConfig({ path: absolute, cause }),
    })
  })

const isConfig = (value: unknown): value is Config =>
  Predicate.isObject(value) &&
  "projects" in value &&
  Array.isArray(value.projects) &&
  "checks" in value &&
  Array.isArray(value.checks)

export interface Loaded {
  readonly config: Config
  readonly workspace: Layer.Layer<Workspace.Workspace, never, Path.Path>
}

export const load = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const absolute = path.resolve(file)
    const { default: config } = yield* importModule(absolute)
    if (!isConfig(config)) {
      return yield* new InvalidConfig({
        path: absolute,
        cause: "the default export needs `projects` and `checks`",
      })
    }
    const definition = yield* Schema.decodeUnknownEffect(Workspace.WorkspaceDefinition.schema)({
      projects: config.projects,
    }).pipe(Effect.mapError((cause) => new InvalidConfig({ path: absolute, cause })))
    return {
      config,
      workspace: Workspace.layer(definition, path.dirname(absolute)),
    } satisfies Loaded
  })
