#!/usr/bin/env node
import { Argument, Command, Flag } from "effect/unstable/cli"
import { Effect, Option, Schema } from "effect"
import { NodeServices } from "@effect/platform-node"
import { CliMatchFoundError } from "../src/Cli/Audit.ts"
import { runCli } from "../src/Cli/Run.ts"

const recipeArg = Argument.string("recipe")
const verifyFlag = Flag.boolean("verify")
const applyFlag = Flag.boolean("apply")
const failOnMatchFlag = Flag.boolean("fail-on-match")
const noColorFlag = Flag.boolean("no-color")
const inputFlag = Flag.optional(Flag.string("input"))
const cwdFlag = Flag.optional(Flag.string("cwd"))

const JsonValue = Schema.fromJsonString(Schema.Unknown)

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Raw CLI input string or JSON value passed to recipe input runner.
const parseInput = (inputOption: Option.Option<string>): unknown => {
  if (Option.isNone(inputOption)) return undefined
  const raw = inputOption.value
  const decoded = Schema.decodeExit(JsonValue)(raw)
  return decoded._tag === "Success" ? decoded.value : raw
}

const runCmd = Command.make(
  "run",
  {
    recipe: recipeArg,
    verify: verifyFlag,
    apply: applyFlag,
    noColor: noColorFlag,
    input: inputFlag,
    cwd: cwdFlag,
  },
  (parsed) =>
    runCli({
      recipePath: parsed.recipe,
      input: parseInput(parsed.input),
      cwd: Option.getOrUndefined(parsed.cwd),
      mode: parsed.apply ? "apply" : parsed.verify ? "verify" : "preview",
      noColor: parsed.noColor,
    }),
)

const scanCmd = Command.make(
  "scan",
  {
    recipe: recipeArg,
    failOnMatch: failOnMatchFlag,
    noColor: noColorFlag,
    input: inputFlag,
    cwd: cwdFlag,
  },
  (parsed) =>
    runCli({
      recipePath: parsed.recipe,
      input: parseInput(parsed.input),
      cwd: Option.getOrUndefined(parsed.cwd),
      mode: "scan",
      failOnMatch: parsed.failOnMatch,
      noColor: parsed.noColor,
    }),
)

const safemodsCmd = Command.make("safemods").pipe(Command.withSubcommands([runCmd, scanCmd]))

const cli = Command.run(safemodsCmd, { version: "1.0.0" })

Effect.runPromise(cli.pipe(Effect.provide(NodeServices.layer))).catch((cause: unknown) => {
  if (cause instanceof CliMatchFoundError) {
    process.exit(1)
  }
  process.exit(1)
})
