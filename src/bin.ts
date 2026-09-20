#!/usr/bin/env node
import * as Path from "node:path"
import { pathToFileURL } from "node:url"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Option, Predicate, Runtime, Schema } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as Check from "./Check.ts"
import * as Git from "./Git.ts"
import * as Workspace from "./Workspace/index.ts"

class FindingsReported extends Data.TaggedError("FindingsReported")<{ readonly count: number }> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

class CheckFailed extends Data.TaggedError("CheckFailed")<{ readonly cause: unknown }> {
  readonly [Runtime.errorExitCode] = 2
}

class InvalidConfig extends Data.TaggedError("InvalidConfig")<{
  readonly path: string
  readonly cause: unknown
}> {}

class SinceWithBaseline extends Data.TaggedError("SinceWithBaseline")<{}> {}

const KnownFindings = Schema.fromJsonString(Schema.Array(Check.Known))

const isConfig = (value: unknown): value is Check.Config =>
  Predicate.isObject(value) &&
  "projects" in value &&
  Array.isArray(value.projects) &&
  "checks" in value &&
  Array.isArray(value.checks)

const loadConfig = (path: string) =>
  Effect.tryPromise({
    try: () => import(pathToFileURL(path).href) as Promise<{ readonly default?: unknown }>,
    catch: (cause) => new InvalidConfig({ path, cause }),
  }).pipe(
    Effect.flatMap((module) =>
      isConfig(module.default)
        ? Effect.succeed(module.default)
        : Effect.fail(
            new InvalidConfig({ path, cause: "the default export needs `projects` and `checks`" }),
          ),
    ),
  )

const check = Command.make(
  "check",
  {
    config: Flag.file("config").pipe(
      Flag.withDefault("safemods.config.ts"),
      Flag.withDescription("Module whose default export lists projects and checks"),
    ),
    format: Flag.choice("format", ["text", "json"]).pipe(Flag.withDefault("text")),
    baseline: Flag.optional(
      Flag.path("baseline").pipe(
        Flag.withDescription("Known findings; only findings missing from this file fail"),
      ),
    ),
    updateBaseline: Flag.boolean("update-baseline").pipe(
      Flag.withDescription("Record the current findings in the baseline and succeed"),
    ),
    since: Flag.optional(
      Flag.string("since").pipe(
        Flag.withDescription("Git ref; only findings this change introduced fail"),
      ),
    ),
  },
  ({ config: configFile, format, baseline, updateBaseline, since }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const baselinePath = Option.getOrUndefined(baseline)
      const ref = Option.getOrUndefined(since)
      if (ref !== undefined && baselinePath !== undefined) return yield* new SinceWithBaseline()
      const configPath = Path.resolve(configFile)
      const config = yield* loadConfig(configPath)
      const definition = yield* Schema.decodeUnknownEffect(Workspace.WorkspaceDefinition.schema)({
        projects: config.projects,
      })
      const root = Path.dirname(configPath)
      const workspace = Workspace.layer(definition, root)
      const runChecks = (overlay?: Workspace.Overlay) =>
        Check.run(config.checks, overlay).pipe(Effect.provide(workspace))
      const comparisons = config.comparisons ?? []

      if (ref === undefined && comparisons.length > 0) {
        yield* Console.error(
          `skipped without --since: ${comparisons.map((check) => check.name).join(", ")}`,
        )
      }

      const changes = ref === undefined ? undefined : yield* Git.changesSince(root, ref)
      const atRef =
        changes === undefined
          ? []
          : yield* runChecks({ files: changes.previous, deleted: changes.added })
      const findings = yield* runChecks()
      const compared =
        changes === undefined
          ? []
          : yield* Check.runCompared(comparisons, changes.previous).pipe(Effect.provide(workspace))

      if (updateBaseline && baselinePath !== undefined) {
        const known = findings.map(({ check, path, message }) => ({ check, path, message }))
        yield* fs.writeFileString(baselinePath, `${JSON.stringify(known, undefined, 2)}\n`)
        return yield* Console.error(`recorded ${known.length} known finding(s)`)
      }

      const known =
        baselinePath === undefined
          ? atRef
          : yield* Effect.flatMap(
              fs.readFileString(baselinePath),
              Schema.decodeEffect(KnownFindings),
            )
      const newFindings = Check.introducedSince(known, findings)
      const introduced = Check.sorted([...newFindings, ...compared])
      yield* Console.log(
        format === "json"
          ? JSON.stringify(introduced, undefined, 2)
          : introduced.map(Check.format).join("\n"),
      )
      yield* Console.error(
        `${introduced.length} finding(s), ${findings.length - newFindings.length} known`,
      )
      if (introduced.length > 0) return yield* new FindingsReported({ count: introduced.length })
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof FindingsReported ? cause : new CheckFailed({ cause }),
      ),
    ),
).pipe(Command.withDescription("Run whole-program checks and fail on findings"))

const safemods = Command.make("safemods").pipe(Command.withSubcommands([check]))

NodeRuntime.runMain(
  Command.run(safemods, { version: "0.2.0" }).pipe(Effect.provide(NodeServices.layer)),
)
