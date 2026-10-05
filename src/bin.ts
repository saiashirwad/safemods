#!/usr/bin/env node
import { NodeServices } from "@effect/platform-node"
import { NodeRuntime } from "@effect/platform-node-shared"
import { Console, Data, Effect, Predicate, Runtime, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { applyVerifiedPlan } from "./Application.ts"
import * as Check from "./Check.ts"
import * as Config from "./Config.ts"
import * as Inspect from "./Inspect.ts"
import * as Finding from "./Finding.ts"
import type * as Recipe from "./Recipe.ts"
import { actionOf, type FilePreview, verify } from "./Verification/index.ts"
import * as Workspace from "./Workspace/index.ts"

class FindingsReported extends Data.TaggedError("FindingsReported")<{ readonly count: number }> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

class PlanRejected extends Data.TaggedError("PlanRejected")<{}> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

class CommandFailed extends Data.TaggedError("CommandFailed")<{ readonly cause: unknown }> {
  readonly [Runtime.errorExitCode] = 2
  readonly [Runtime.errorReported] = false
}

const reportFailure = (cause: unknown, format: "text" | "json" = "text") =>
  Effect.gen(function* () {
    if (cause instanceof FindingsReported || cause instanceof PlanRejected) return yield* cause
    const message = cause instanceof Inspect.NotFound ?
      cause.what :
      cause instanceof Config.InvalidConfig ?
      `${cause.path}: ${cause.cause instanceof Error ? cause.cause.message : String(cause.cause)}` :
      cause instanceof Error ?
      cause.message :
      String(cause)
    if (format === "json") yield* Console.log(JSON.stringify({ error: message }))
    else yield* Console.error(message)
    return yield* new CommandFailed({ cause })
  })

const configFlag = Flag.file("config").pipe(
  Flag.withDefault("safemods.config.ts"),
  Flag.withDescription("Module whose default export lists projects and checks"),
)

const check = Command.make(
  "check",
  {
    config: configFlag,
    format: Flag.choice("format", ["text", "json"]).pipe(Flag.withDefault("text")),
  },
  ({ config: configFile, format }) =>
    Effect.gen(function* () {
      const { config, workspace } = yield* Config.load(configFile)
      const findings = yield* Check.run(config.checks).pipe(Effect.provide(workspace))
      yield* Console.log(
        format === "json" ?
          JSON.stringify(findings, undefined, 2) :
          findings.map(Check.format).join("\n"),
      )
      yield* Console.error(`${findings.length} finding(s)`)
      if (findings.length > 0) return yield* new FindingsReported({ count: findings.length })
    }).pipe(Effect.catch((cause) => reportFailure(cause, format))),
).pipe(Command.withDescription("Run whole-program checks and fail on findings"))

type Answer = ReturnType<typeof Inspect.type> | typeof Inspect.map

const isRecipe = (value: unknown): value is Recipe.Recipe<unknown> =>
  Predicate.isObject(value) &&
  "name" in value &&
  "version" in value &&
  "policies" in value &&
  "run" in value &&
  typeof value.run === "function"

const listed = 10

const capped = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.length <= listed ?
    lines :
    [...lines.slice(0, listed), `  ... and ${lines.length - listed} more`]

const unresolvedLine = (
  sources: ReadonlyArray<FilePreview>,
  finding: Finding.Finding,
): string => {
  const source = sources.find((file) => file.fileName === finding.fileName)
  if (source?.before.exists !== true) return `  ${finding.fileName}:? ${finding.message}`
  const { fileName, line, column, message } = Finding.locate(finding, source.before.text)
  return `  ${fileName}:${line}:${column} ${message}`
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
      const { workspace } = yield* Config.load(configFile)
      const recipe = Object.values(yield* Config.importModule(recipeFile)).find(isRecipe)
      if (recipe === undefined) {
        return yield* new Config.InvalidConfig({ path: recipeFile, cause: "no export is a recipe" })
      }
      const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(inputJson)
      const input = recipe.schema === undefined ?
        json :
        yield* Schema.decodeUnknownEffect(recipe.schema)(json)

      yield* Effect.gen(function* () {
        yield* Console.log(`${recipe.name} ${recipe.version}`)
        const verified = yield* verify(recipe, input).pipe(
          Effect.catchTag("VerificationFailure", (failure) =>
            Effect.gen(function* () {
              yield* Console.log(`rejected (${failure.policy}): ${failure.detail}`)
              yield* Console.log(
                capped(
                  (failure.diagnostics ?? []).map(
                    ({ fileName, line, column, code, message }) =>
                      `  ${fileName ?? ""}:${line}:${column} TS${code} ${message.split("\n")[0]}`,
                  ),
                ).join("\n"),
              )
              yield* Console.log("nothing was written")
              return yield* new PlanRejected()
            })),
        )
        yield* Console.log(
          capped(
            verified.preview.files.map((file) => `  ${actionOf(file).padEnd(6)} ${file.fileName}`),
          ).join("\n"),
        )
        if (verified.plan.unsupported.length > 0) {
          yield* Console.log(`left for you (${verified.plan.unsupported.length}):`)
          yield* Console.log(
            capped(
              verified.plan.unsupported.map((finding) =>
                unresolvedLine(verified.preview.sources, finding)
              ),
            ).join("\n"),
          )
        }
        yield* Console.log(
          `verified: ${verified.diagnosticDiff.introduced.length} new diagnostic(s), ${verified.diagnosticDiff.resolved.length} resolved`,
        )
        if (!apply) return yield* Console.log("not written: pass --apply")
        yield* applyVerifiedPlan(verified)
        yield* Console.log(`applied to ${verified.preview.files.length} file(s)`)
      }).pipe(Effect.provide(workspace))
    }).pipe(Effect.catch((cause) => reportFailure(cause))),
).pipe(Command.withDescription("Plan a recipe, verify it, and write it only with --apply"))

const inspecting = (configFile: string, answer: Answer) =>
  Effect.gen(function* () {
    const { workspace } = yield* Config.load(configFile)
    const lines = yield* Workspace.Workspace.use((service) => service.withSnapshot(answer)).pipe(
      Effect.provide(workspace),
    )
    yield* Console.log(lines.join("\n"))
  }).pipe(Effect.catch((cause) => reportFailure(cause)))

const at = (name: string, description: string, answer: (position: string) => Answer) =>
  Command.make(
    name,
    { config: configFlag, position: Argument.string("path:line:column") },
    ({ config, position }) => inspecting(config, answer(position)),
  ).pipe(Command.withDescription(description))

const about = (name: string, description: string, answer: (path: string) => Answer) =>
  Command.make(
    name,
    { config: configFlag, path: Argument.string("path") },
    ({ config, path }) => inspecting(config, answer(path)),
  ).pipe(Command.withDescription(description))

const map = Command.make(
  "map",
  { config: configFlag },
  ({ config }) => inspecting(config, Inspect.map),
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
