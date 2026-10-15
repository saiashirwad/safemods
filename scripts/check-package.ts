import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Path, Runtime, Schema } from "effect"
import { createRequire } from "node:module"
import { runCommand } from "./run-command.ts"

const RootManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
})

const PackedManifest = Schema.Struct({
  exports: Schema.Record(
    Schema.String,
    Schema.Struct({ default: Schema.String, types: Schema.String }),
  ),
  bin: Schema.Struct({ safemods: Schema.String }),
})

class CheckFailed extends Data.TaggedError("CheckFailed")<{ readonly message: string }> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

type Step = "pack" | "install" | "exports" | "check" | "run" | "typecheck"

interface Execution {
  readonly command: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const indent = (text: string) =>
  text.trim() === "" ? "  (empty)" : text.trimEnd().replace(/^/gm, "  ")

const failure = (step: Step, expected: string, execution: Execution | undefined) =>
  new CheckFailed({
    message: [
      `Packed consumer failed at step "${step}"`,
      `expected: ${expected}`,
      ...(execution === undefined ? [] : [
        `command: ${execution.command}`,
        `exit code: ${execution.exitCode}`,
        `stdout:\n${indent(execution.stdout)}`,
        `stderr:\n${indent(execution.stderr)}`,
      ]),
    ].join("\n"),
  })

/** Assert a condition that no command output explains. */
const check = (step: Step, expected: string, condition: boolean) =>
  condition ? Effect.void : Effect.fail(failure(step, expected, undefined))

/** Assert a condition about a command, failing with its command line and captured output. */
const expectRun = (step: Step, execution: Execution, expected: string, condition: boolean) =>
  condition ? Effect.void : Effect.fail(failure(step, expected, execution))

const execute = Effect.fn("execute")(function* (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const output = yield* runCommand(executable, args, cwd)
  return { command: [executable, ...args].join(" "), ...output }
})

// Run the pnpm that started us. A `.js` CLI needs Node (Windows cannot spawn it
// directly); a native pnpm runs as-is. A shell would concatenate arguments
// without escaping, splitting any path that contains a space.
const runPnpm = (step: Step, args: ReadonlyArray<string>, cwd: string) => {
  const entry = process.env.npm_execpath ?? "pnpm"
  return Effect.flatMap(
    /\.(c|m)?js$/.test(entry) ?
      execute(process.execPath, [entry, ...args], cwd) :
      execute(entry, args, cwd),
    (execution) =>
      Effect.as(
        expectRun(step, execution, `pnpm ${args[0]} exits 0`, execution.exitCode === 0),
        execution,
      ),
  )
}

const program = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(new URL("..", import.meta.url))

    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "safemods-package-check-" })
    const consumer = path.join(temporary, "consumer")
    const packageRoot = path.join(consumer, "node_modules", "safemods")

    const packed = yield* runPnpm("pack", ["pack", "--pack-destination", temporary], root)
    const archive = (yield* fs.readDirectory(temporary)).find((name) => name.endsWith(".tgz"))
    if (archive === undefined) {
      return yield* failure("pack", "pnpm pack produces a .tgz tarball", packed)
    }
    const rootManifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RootManifest))(
      yield* fs.readFileString(path.join(root, "package.json")),
    )
    // The consumer programs are real files so the editor and tsc see them as such.
    yield* fs.copy(path.join(root, "fixtures", "package-consumer"), consumer)
    yield* fs.writeFileString(
      path.join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          safemods: `file:../${archive}`,
          effect: rootManifest.dependencies.effect,
          typescript: rootManifest.dependencies.typescript,
        },
      }),
    )
    yield* runPnpm("install", ["install", "--ignore-scripts"], consumer)

    const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackedManifest))(
      yield* fs.readFileString(path.join(packageRoot, "package.json")),
    )
    yield* check(
      "exports",
      `the package exports only "." (found: ${Object.keys(manifest.exports).join(", ")})`,
      Object.keys(manifest.exports).join() === ".",
    )
    const entry = manifest.exports["."]
    if (entry === undefined) return yield* failure("exports", `the package exports "."`, undefined)
    for (const field of ["default", "types"] as const) {
      yield* check(
        "exports",
        `export . ${field} file ${entry[field]} exists in the package`,
        yield* fs.exists(path.join(packageRoot, entry[field])),
      )
    }
    const url = yield* path.toFileUrl(path.join(packageRoot, entry.default))
    const namespace = yield* Effect.promise(() => import(url.href))
    yield* check(
      "exports",
      `export . imports with at least one member`,
      Object.keys(namespace).length > 0,
    )

    yield* fs.writeFileString(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ESNext",
          strict: true,
        },
        include: ["src/**/*.ts", "safemods.config.ts"],
      }),
    )
    const source = path.join(consumer, "src", "example.ts")
    yield* fs.writeFileString(source, "// @ts-ignore\nexport const value = 1\n")

    const bin = path.join(packageRoot, manifest.bin.safemods)
    const checkConsumer = () =>
      execute(process.execPath, [bin, "check", "--format", "json"], consumer)

    const rejected = yield* checkConsumer()
    yield* expectRun(
      "check",
      rejected,
      "exit code 1 for the @ts-ignore finding",
      rejected.exitCode === 1,
    )
    yield* expectRun("check", rejected, "stdout is a JSON array", /^\s*\[/.test(rejected.stdout))
    const findings = yield* Effect.sync(() => JSON.parse(rejected.stdout))
    yield* expectRun("check", rejected, "exactly one finding", findings.length === 1)
    yield* expectRun(
      "check",
      rejected,
      `finding fileName is "src/example.ts"`,
      findings[0].fileName === "src/example.ts",
    )
    yield* expectRun(
      "check",
      rejected,
      `finding check is "suppressions"`,
      findings[0].check === "suppressions",
    )
    yield* expectRun(
      "check",
      rejected,
      "finding message mentions @ts-ignore",
      /@ts-ignore/.test(findings[0].message),
    )

    yield* fs.writeFileString(source, "export const value = 1\n")
    const accepted = yield* checkConsumer()
    yield* expectRun(
      "check",
      accepted,
      "exit code 0 once the suppression is removed",
      accepted.exitCode === 0,
    )
    yield* expectRun("check", accepted, "stdout is a JSON array", /^\s*\[/.test(accepted.stdout))
    const remaining = yield* Effect.sync(() => JSON.parse(accepted.stdout))
    yield* expectRun(
      "check",
      accepted,
      "an empty findings array",
      Array.isArray(remaining) && remaining.length === 0,
    )

    yield* fs.writeFileString(source, "export const value = 1; debugger;\n")
    const runRecipe = (...args: ReadonlyArray<string>) =>
      execute(process.execPath, [bin, "run", "recipe.ts", ...args], consumer)

    const preview = yield* runRecipe()
    yield* expectRun("run", preview, "exit code 0 for the preview", preview.exitCode === 0)
    yield* expectRun(
      "run",
      preview,
      "diff removes the debugger line",
      preview.stdout.includes("-export const value = 1; debugger;"),
    )
    yield* expectRun(
      "run",
      preview,
      "diff adds the line without debugger",
      preview.stdout.includes("+export const value = 1;"),
    )
    yield* expectRun(
      "run",
      preview,
      "the preview leaves the source untouched",
      (yield* fs.readFileString(source)).includes("debugger;"),
    )

    const applied = yield* runRecipe("--apply")
    yield* expectRun("run", applied, "exit code 0 for --apply", applied.exitCode === 0)
    yield* expectRun(
      "run",
      applied,
      "--apply removes debugger from the source",
      !(yield* fs.readFileString(source)).includes("debugger;"),
    )

    const typescript = createRequire(yield* fs.realPath(path.join(packageRoot, "package.json")))
      .resolve("typescript/package.json")
    const types = yield* execute(
      process.execPath,
      [
        path.join(path.dirname(typescript), "bin", "tsc"),
        "--noEmit",
        "-p",
        path.join(consumer, "tsconfig.json"),
      ],
      consumer,
    )
    yield* expectRun(
      "typecheck",
      types,
      "consumer programs typecheck against the packed declarations (exit code 0)",
      types.exitCode === 0,
    )

    yield* Console.log(
      "Packed consumer: the root entry point imports, consumer recipes typecheck, check exits 1 then 0, run previews then applies, declarations typecheck",
    )
  }),
)

const report = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catch((error) =>
      error instanceof CheckFailed ?
        Effect.andThen(Console.error(error.message), Effect.fail(error)) :
        Effect.fail(error)
    ),
  )

NodeRuntime.runMain(report(program).pipe(Effect.provide(NodeServices.layer)))
