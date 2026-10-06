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

const check = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new CheckFailed({ message }))

// Run the pnpm that started us. A `.js` CLI needs Node (Windows cannot spawn it
// directly); a native pnpm runs as-is. A shell would concatenate arguments
// without escaping, splitting any path that contains a space.
const runPnpm = (args: ReadonlyArray<string>, cwd: string) => {
  const entry = process.env.npm_execpath ?? "pnpm"
  return /\.(c|m)?js$/.test(entry) ?
    runCommand(process.execPath, [entry, ...args], cwd) :
    runCommand(entry, args, cwd)
}

const program = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* path.fromFileUrl(new URL("..", import.meta.url))

    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "safemods-package-check-" })
    const consumer = path.join(temporary, "consumer")
    const packageRoot = path.join(consumer, "node_modules", "safemods")

    yield* runPnpm(["pack", "--pack-destination", temporary], root)
    const archive = (yield* fs.readDirectory(temporary)).find((name) => name.endsWith(".tgz"))
    if (archive === undefined) {
      return yield* new CheckFailed({ message: "pnpm pack did not produce a tarball" })
    }
    const rootManifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RootManifest))(
      yield* fs.readFileString(path.join(root, "package.json")),
    )
    yield* fs.makeDirectory(path.join(consumer, "src"), { recursive: true })
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
    yield* runPnpm(["install", "--ignore-scripts"], consumer)

    const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackedManifest))(
      yield* fs.readFileString(path.join(packageRoot, "package.json")),
    )
    for (const [name, entry] of Object.entries(manifest.exports)) {
      for (const field of ["default", "types"] as const) {
        yield* check(
          yield* fs.exists(path.join(packageRoot, entry[field])),
          `${name} is missing ${field}`,
        )
      }
      const url = yield* path.toFileUrl(path.join(packageRoot, entry.default))
      const namespace = yield* Effect.promise(() => import(url.href))
      yield* check(Object.keys(namespace).length > 0, `${name} imports`)
    }

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
    yield* fs.writeFileString(
      path.join(consumer, "src", "public-api.ts"),
      [
        'import { Effect, Schema } from "effect"',
        'import { isDebuggerStatement } from "typescript/unstable/ast/is"',
        'import { Check, Proposal, Query, Recipe, Migration, Workspace, WorkspacePath } from "safemods"',
        'export const recipe = Recipe.perProject("remove-debugger", {',
        '  version: "1.0.0",',
        "  run: (project) => Effect.gen(function* () {",
        "    const statements = yield* Query.nodes(project, isDebuggerStatement)",
        "    return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))",
        "  }),",
        "})",
        'const input = Recipe.define("encoded-input", {',
        '  version: "1.0.0", schema: Schema.FiniteFromString,',
        '  run: (_snapshot, count) => Effect.succeed(Proposal.createFile(Schema.decodeUnknownSync(WorkspacePath.schema)("created.ts"), `export const count = ${count}`)),',
        "})",
        "export const migrate = Migration.verify(input, 3).pipe(Effect.flatMap((verified) => verified.apply))",
        'export const check = Check.perProject("identifiers", (project) => Query.identifiers(project).pipe(Effect.map((found) => found.map((selection) => Check.report(selection, "identifier")))))',
        "export const program = Workspace.Workspace.use((workspace) => workspace.withSnapshot((snapshot) => recipe.run(snapshot, undefined)))",
      ].join("\n"),
    )
    yield* fs.writeFileString(
      path.join(consumer, "safemods.config.ts"),
      [
        'import { suppressions } from "safemods/Checks"',
        'import type * as Config from "safemods/Config"',
        "export default {",
        '  projects: [{ id: "consumer", config: "tsconfig.json" }],',
        '  checks: [suppressions({ within: "src/**" })],',
        "} satisfies Config.Config",
      ].join("\n"),
    )
    const source = path.join(consumer, "src", "example.ts")
    yield* fs.writeFileString(source, "// @ts-ignore\nexport const value = 1\n")

    const bin = path.join(packageRoot, manifest.bin.safemods)
    const checkConsumer = () =>
      runCommand(process.execPath, [bin, "check", "--format", "json"], consumer)

    const rejected = yield* checkConsumer()
    yield* check(rejected.exitCode === 1, `${rejected.stdout}\n${rejected.stderr}`)
    yield* check(/^\s*\[/.test(rejected.stdout), `${rejected.stdout}\n${rejected.stderr}`)
    const findings = yield* Effect.sync(() => JSON.parse(rejected.stdout))
    yield* check(findings.length === 1, `${rejected.stdout}`)
    yield* check(findings[0].fileName === "src/example.ts", `${rejected.stdout}`)
    yield* check(findings[0].check === "suppressions", `${rejected.stdout}`)
    yield* check(/@ts-ignore/.test(findings[0].message), `${rejected.stdout}`)

    yield* fs.writeFileString(source, "export const value = 1\n")
    const accepted = yield* checkConsumer()
    yield* check(accepted.exitCode === 0, `${accepted.stdout}\n${accepted.stderr}`)
    yield* check(/^\s*\[/.test(accepted.stdout), `${accepted.stdout}\n${accepted.stderr}`)
    const remaining = yield* Effect.sync(() => JSON.parse(accepted.stdout))
    yield* check(Array.isArray(remaining) && remaining.length === 0, `${accepted.stdout}`)

    yield* fs.writeFileString(
      path.join(consumer, "recipe.ts"),
      [
        'import { Effect } from "effect"',
        'import { isDebuggerStatement } from "typescript/unstable/ast/is"',
        'import { Proposal, Query, Recipe } from "safemods"',
        'export default Recipe.perProject("remove-debugger", {',
        '  version: "1.0.0",',
        "  run: (project, input) => Effect.gen(function* () {",
        '    if (input !== undefined) throw new Error("absent input must be undefined")',
        "    const statements = yield* Query.nodes(project, isDebuggerStatement)",
        "    return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))",
        "  }),",
        "})",
      ].join("\n"),
    )
    yield* fs.writeFileString(source, "export const value = 1; debugger;\n")
    const runRecipe = (...args: ReadonlyArray<string>) =>
      runCommand(process.execPath, [bin, "run", "recipe.ts", ...args], consumer)

    const preview = yield* runRecipe()
    yield* check(preview.exitCode === 0, `${preview.stdout}\n${preview.stderr}`)
    yield* check(preview.stdout.includes("-export const value = 1; debugger;"), preview.stdout)
    yield* check(preview.stdout.includes("+export const value = 1;"), preview.stdout)
    yield* check((yield* fs.readFileString(source)).includes("debugger;"), preview.stdout)

    const applied = yield* runRecipe("--apply")
    yield* check(applied.exitCode === 0, `${applied.stdout}\n${applied.stderr}`)
    yield* check(!(yield* fs.readFileString(source)).includes("debugger;"), applied.stdout)

    const typescript = createRequire(yield* fs.realPath(path.join(packageRoot, "package.json")))
      .resolve("typescript/package.json")
    const types = yield* runCommand(
      process.execPath,
      [
        path.join(path.dirname(typescript), "bin", "tsc"),
        "--noEmit",
        "-p",
        path.join(consumer, "tsconfig.json"),
      ],
      consumer,
    )
    yield* check(types.exitCode === 0, `${types.stdout}\n${types.stderr}`)

    yield* Console.log(
      `Packed consumer: ${
        Object.keys(manifest.exports).length
      } entry points import, consumer recipes typecheck, check exits 1 then 0, run previews then applies, declarations typecheck`,
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
