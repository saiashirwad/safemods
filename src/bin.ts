#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Path, Predicate, Runtime, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { applyVerifiedPlan } from "./Application.ts"
import * as Check from "./Check.ts"
import * as Inspect from "./Inspect.ts"
import type { UnsupportedFinding } from "./Plan.ts"
import * as Position from "./Position.ts"
import * as Recipe from "./Recipe.ts"
import { actionOf, type PublicFilePreview, verify } from "./Verification/index.ts"
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

class PlanRejected extends Data.TaggedError("PlanRejected")<{ readonly planId: string }> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

const isConfig = (value: unknown): value is Check.Config =>
  Predicate.isObject(value) &&
  "projects" in value &&
  Array.isArray(value.projects) &&
  "checks" in value &&
  Array.isArray(value.checks)

const loadModule = (file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const url = yield* path.toFileUrl(file)
    return yield* Effect.tryPromise({
      try: () => import(url.href) as Promise<Readonly<Record<string, unknown>>>,
      catch: (cause) => new InvalidConfig({ path: file, cause }),
    })
  })

const loadConfig = (path: string) =>
  loadModule(path).pipe(
    Effect.flatMap((module) =>
      isConfig(module.default)
        ? Effect.succeed(module.default)
        : new InvalidConfig({ path, cause: "the default export needs `projects` and `checks`" }),
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
  },
  ({ config: configFile, format }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const configPath = yield* fs.realPath(configFile)
      const config = yield* loadConfig(configPath)
      const definition = yield* Schema.decodeUnknownEffect(Workspace.WorkspaceDefinition.schema)({
        projects: config.projects,
      })
      const findings = yield* Check.run(config.checks).pipe(
        Effect.provide(Workspace.layer(definition, path.dirname(configPath))),
      )
      yield* Console.log(
        format === "json"
          ? JSON.stringify(findings, undefined, 2)
          : findings.map(Check.format).join("\n"),
      )
      yield* Console.error(`${findings.length} finding(s)`)
      if (findings.length > 0) return yield* new FindingsReported({ count: findings.length })
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof FindingsReported ? cause : new CheckFailed({ cause }),
      ),
    ),
).pipe(Command.withDescription("Run whole-program checks and fail on findings"))

type Answer = ReturnType<typeof Inspect.type> | typeof Inspect.map

const configFlag = Flag.file("config").pipe(Flag.withDefault("safemods.config.ts"))

const isRecipe = (value: unknown): value is Recipe.Recipe<unknown> =>
  Predicate.isObject(value) &&
  "name" in value &&
  "version" in value &&
  "policies" in value &&
  "run" in value &&
  typeof value.run === "function"

const listed = 10

const capped = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.length <= listed
    ? lines
    : [...lines.slice(0, listed), `  ... and ${lines.length - listed} more`]

const unresolvedLine = (
  sources: ReadonlyArray<PublicFilePreview>,
  finding: UnsupportedFinding,
): string => {
  const source = sources.find(
    (file) => file.projectId === finding.projectId && file.fileName === finding.fileName,
  )
  const at =
    source?.before.exists === true ? Position.at(source.before.text, finding.start) : undefined
  return `  ${finding.fileName}:${at === undefined ? "?" : `${at.line}:${at.column}`} ${finding.reason}`
}

const run = Command.make(
  "run",
  {
    config: configFlag,
    recipe: Argument.file("recipe"),
    input: Flag.string("input").pipe(
      Flag.withDefault("null"),
      Flag.withDescription("The recipe's input as JSON"),
    ),
    apply: Flag.boolean("apply").pipe(
      Flag.withDescription("Write the verified plan; without it nothing is written"),
    ),
  },
  ({ config: configFile, recipe: recipeFile, input: inputJson, apply }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const configPath = path.resolve(configFile)
      const root = path.dirname(configPath)
      const config = yield* loadConfig(configPath)
      const definition = yield* Schema.decodeUnknownEffect(Workspace.WorkspaceDefinition.schema)({
        projects: config.projects,
      })
      const recipePath = path.resolve(recipeFile)
      const recipe = Object.values(yield* loadModule(recipePath)).find(isRecipe)
      if (recipe === undefined) {
        return yield* new InvalidConfig({ path: recipePath, cause: "no export is a recipe" })
      }
      const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(inputJson)
      const input =
        recipe.schema === undefined ? json : yield* Schema.decodeUnknownEffect(recipe.schema)(json)

      yield* Effect.gen(function* () {
        const plan = yield* Recipe.run(recipe, input)
        const files = new Set([
          ...plan.edits.map((edit) => edit.fileName),
          ...plan.fileOperations.map((operation) => operation.fileName),
        ])
        yield* Console.log(
          `plan ${plan.planId.slice(0, 12)}  ${recipe.name} ${recipe.version}  ${plan.edits.length} edit(s), ${plan.fileOperations.length} file operation(s), ${files.size} file(s)`,
        )
        const verified = yield* verify(plan, recipe, input).pipe(
          Effect.catchTag("VerificationFailure", (failure) =>
            Effect.gen(function* () {
              yield* Console.log(`rejected (${failure.policy}): ${failure.detail}`)
              yield* Console.log(
                capped(
                  (failure.diagnostics ?? []).map(
                    ({ fileName, line, column, code, message }) =>
                      `  ${fileName === undefined ? "" : path.relative(root, fileName)}:${line}:${column} TS${code} ${message.split("\n")[0]}`,
                  ),
                ).join("\n"),
              )
              yield* Console.log("nothing was written")
              return yield* new PlanRejected({ planId: plan.planId })
            }),
          ),
        )
        yield* Console.log(
          capped(
            verified.preview.files.map((file) => `  ${actionOf(file).padEnd(6)} ${file.fileName}`),
          ).join("\n"),
        )
        if (plan.unsupported.length > 0) {
          yield* Console.log(`left for you (${plan.unsupported.length}):`)
          yield* Console.log(
            capped(
              plan.unsupported.map((finding) => unresolvedLine(verified.preview.sources, finding)),
            ).join("\n"),
          )
        }
        yield* Console.log(
          `verified: ${verified.diagnosticDiff.introduced.length} new diagnostic(s), ${verified.diagnosticDiff.resolved.length} resolved`,
        )
        if (!apply) return yield* Console.log("not written: pass --apply")
        yield* applyVerifiedPlan(verified)
        yield* Console.log(`applied to ${verified.preview.files.length} file(s)`)
      }).pipe(Effect.provide(Workspace.layer(definition, root)))
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PlanRejected ? cause : new CheckFailed({ cause }),
      ),
    ),
).pipe(Command.withDescription("Plan a recipe, verify it, and write it only with --apply"))

const inspecting = (configFile: string, answer: Answer) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const configPath = path.resolve(configFile)
    const config = yield* loadConfig(configPath)
    const definition = yield* Schema.decodeUnknownEffect(Workspace.WorkspaceDefinition.schema)({
      projects: config.projects,
    })
    const lines = yield* Workspace.Workspace.use((workspace) =>
      workspace.withSnapshot(answer),
    ).pipe(Effect.provide(Workspace.layer(definition, path.dirname(configPath))))
    yield* Console.log(lines.join("\n"))
  }).pipe(Effect.mapError((cause) => new CheckFailed({ cause })))

const at = (name: string, description: string, answer: (position: string) => Answer) =>
  Command.make(
    name,
    { config: configFlag, position: Argument.string("path:line:column") },
    ({ config, position }) => inspecting(config, answer(position)),
  ).pipe(Command.withDescription(description))

const about = (name: string, description: string, answer: (path: string) => Answer) =>
  Command.make(name, { config: configFlag, path: Argument.string("path") }, ({ config, path }) =>
    inspecting(config, answer(path)),
  ).pipe(Command.withDescription(description))

const map = Command.make("map", { config: configFlag }, ({ config }) =>
  inspecting(config, Inspect.map),
).pipe(
  Command.withDescription("Every file with its size, export count and how many files import it"),
)

const safemods = Command.make("safemods").pipe(
  Command.withSubcommands([
    check,
    run,
    map,
    at("type", "The type and declaration of the node at a position", Inspect.type),
    at("refs", "Every reference the compiler finds to the symbol at a position", Inspect.refs),
    at("calls", "Every direct call of the function at a position", Inspect.calls),
    about("exports", "What a file exports, with types", Inspect.exports),
    about("deps", "What a file imports and what imports it", Inspect.deps),
  ]),
)

NodeRuntime.runMain(
  Command.run(safemods, { version: "0.2.0" }).pipe(Effect.provide(NodeServices.layer)),
)
