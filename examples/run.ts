/**
 * Run an example recipe against a disposable copy of its fixture.
 * The files under fixtures/ are never opened as a workspace root and never written.
 *
 *   node examples/run.ts
 *   node examples/run.ts rename-package-import
 *   node examples/run.ts move-module --preview
 *   node examples/run.ts positional-to-options --out /tmp/session-rewrite
 */
import { execFile } from "node:child_process"
import * as NodePath from "node:path"
import { promisify } from "node:util"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Option, Path } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { applyVerifiedPlan } from "../src/Application.ts"
import { layer as nodeLayer, workspaceLayerNode } from "../src/Node.ts"
import { run, type Recipe } from "../src/Recipe.ts"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import { verify } from "../src/Verification/index.ts"
import { ConfiguredProject, WorkspaceDefinition } from "../src/Workspace/index.ts"
import { defaultToNamed } from "./default-to-named.ts"
import { moveModule } from "./move-module.ts"
import { positionalToOptions } from "./positional-to-options.ts"
import { relativeJsExtensions } from "./relative-js-extensions.ts"
import { renamePackageImport } from "./rename-package-import.ts"
import { renameThroughBarrel } from "./rename-through-barrel.ts"

const repoRoot = NodePath.join(import.meta.dirname, "..")
const fixturesRoot = NodePath.join(repoRoot, "fixtures")

export class UnknownExample extends Data.TaggedError("UnknownExample")<{
  readonly id: string
}> {}

export class WritesIntoFixtures extends Data.TaggedError("WritesIntoFixtures")<{
  readonly path: string
}> {}

export class GitFailure extends Data.TaggedError("GitFailure")<{
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  readonly cause: unknown
}> {}

export interface ExampleResult {
  readonly id: string
  readonly fixture: string
  readonly workspace: string
  readonly applied: boolean
  readonly matches: number
  readonly files: ReadonlyArray<{ readonly fileName: string; readonly action: string }>
  readonly diff: string
}

const defineExample = <Input, E, R>(example: {
  readonly id: string
  readonly fixture: string
  readonly recipe: Recipe<Input, E, R>
  readonly input: (project: ConfiguredProject.Type) => Input
}) => ({
  id: example.id,
  fixture: example.fixture,
  execute: (project: ConfiguredProject.Type) => {
    const input = example.input(project)
    return Effect.gen(function* () {
      const plan = yield* run(example.recipe, input)
      const verified = yield* verify(plan, example.recipe, input)
      return { plan, verified }
    })
  },
})

const examples = [
  defineExample({
    id: "rename-package-import",
    fixture: "fixtures/migrations/rename-package-import",
    recipe: renamePackageImport,
    input: () => undefined,
  }),
  defineExample({
    id: "positional-to-options",
    fixture: "fixtures/migrations/positional-to-options",
    recipe: positionalToOptions,
    input: (project) => ({ project }),
  }),
  defineExample({
    id: "rename-through-barrel",
    fixture: "fixtures/migrations/rename-through-barrel",
    recipe: renameThroughBarrel,
    input: () => undefined,
  }),
  defineExample({
    id: "move-module",
    fixture: "fixtures/migrations/move-module",
    recipe: moveModule,
    input: (project) => ({
      project,
      from: ProjectRelativePath.schema.make("src/users/account.ts"),
      to: ProjectRelativePath.schema.make("src/identity/account.ts"),
    }),
  }),
  defineExample({
    id: "default-to-named",
    fixture: "fixtures/migrations/default-to-named",
    recipe: defaultToNamed,
    input: (project) => ({
      project,
      declarationFile: ProjectRelativePath.schema.make("src/auth/authenticate.ts"),
      exportName: "authenticate",
    }),
  }),
  defineExample({
    id: "relative-js-extensions",
    fixture: "fixtures/migrations/relative-js-extensions",
    recipe: relativeJsExtensions,
    input: () => undefined,
  }),
]

export const exampleIds = examples.map((example) => example.id)

const isInside = (root: string, candidate: string, path: Path.Path): boolean => {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

const copyFixture = Effect.fn("copyFixture")(function* (
  fixture: string,
  destination: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const source = path.resolve(repoRoot, fixture)
  const workspace =
    destination === undefined
      ? yield* fs.makeTempDirectory({ prefix: `safemods-${path.basename(fixture)}-` })
      : path.resolve(destination)
  if (isInside(fixturesRoot, workspace, path)) {
    return yield* new WritesIntoFixtures({ path: workspace })
  }
  yield* fs.makeDirectory(workspace, { recursive: true })
  yield* fs.copy(source, workspace, { overwrite: true })
  yield* git(workspace, ["init", "--quiet"])
  yield* git(workspace, ["add", "-A"])
  yield* git(workspace, [
    "-c",
    "user.name=safemods",
    "-c",
    "user.email=safemods@localhost",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ])
  return workspace
})

const execFilePromise = promisify(execFile)

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFilePromise("git", [...args], {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
        },
      })
      return stdout
    },
    catch: (cause) => new GitFailure({ cwd, args, cause }),
  })

export const runExample = Effect.fn("runExample")(function* (
  id: string,
  destination?: string,
  preview = false,
) {
  const example = examples.find((candidate) => candidate.id === id)
  if (example === undefined) {
    return yield* new UnknownExample({ id })
  }
  const workspace = yield* copyFixture(example.fixture, destination)
  const project = yield* ConfiguredProject.make({ id: "app", config: "tsconfig.json" })
  const definition = yield* WorkspaceDefinition.make({ projects: [project] })
  const { plan, verified } = yield* Effect.gen(function* () {
    const executed = yield* example.execute(project)
    if (!preview) {
      yield* applyVerifiedPlan(executed.verified)
    }
    return executed
  }).pipe(Effect.provide(workspaceLayerNode(definition, { cwd: workspace })))
  yield* git(workspace, ["add", "-A"])
  const diff = yield* git(workspace, ["--no-pager", "diff", "--no-color", "HEAD"])
  return {
    id: example.id,
    fixture: NodePath.resolve(repoRoot, example.fixture),
    workspace,
    applied: !preview,
    matches: plan.measurements.matches,
    files: verified.preview.files.map((file) => ({
      fileName: file.fileName,
      action: file.action,
    })),
    diff,
  }
}, Effect.provide(nodeLayer))

const formatResult = (result: ExampleResult): string => {
  const lines = [
    `Example:    ${result.id}`,
    `Fixture:    ${result.fixture}  (unchanged)`,
    `Workspace:  ${result.workspace}`,
    `Matches:    ${result.matches}`,
    `Applied:    ${result.applied ? "yes, to the copy" : "no (--preview)"}`,
    `Inspect:    git -C ${result.workspace} diff HEAD`,
    "Files:",
  ]
  for (const file of result.files) {
    lines.push(`  ${file.action.padEnd(6)} ${file.fileName}`)
  }
  lines.push("", result.diff === "" ? "Diff:        (none)" : result.diff.replace(/\n$/, ""))
  return lines.join("\n")
}

const command = Command.make(
  "example",
  {
    id: Argument.choice("id", exampleIds),
    preview: Flag.boolean("preview").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Plan and verify only; do not apply"),
    ),
    out: Flag.optional(
      Flag.directory("out").pipe(
        Flag.withDescription("Copy destination. Default: a temp directory that is kept"),
      ),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const result = yield* runExample(config.id, Option.getOrUndefined(config.out), config.preview)
      yield* Console.log(formatResult(result))
    }),
).pipe(
  Command.withDescription(
    "Run a recipe against a copy of fixtures/migrations/<id>. The original fixture is never written.",
  ),
)

const isMain =
  process.argv[1] !== undefined && NodePath.resolve(process.argv[1]) === import.meta.filename

if (isMain) {
  NodeRuntime.runMain(
    Command.run(command, { version: "0.2.0" }).pipe(Effect.provide(NodeServices.layer)),
  )
}
