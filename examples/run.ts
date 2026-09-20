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
import { run, type Recipe } from "../src/Recipe.ts"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import { actionOf, verify } from "../src/Verification/index.ts"
import * as Workspace from "../src/Workspace/index.ts"
import { asAssertionToSatisfies } from "./as-assertion-to-satisfies.ts"
import { defaultToNamed } from "./default-to-named.ts"
import { enumToConstObject } from "./enum-to-const-object.ts"
import { jsxButtonProps } from "./jsx-button-props.ts"
import { moveModule } from "./move-module.ts"
import { overloadedMethod } from "./overloaded-method.ts"
import { packageEntryPointSplit } from "./package-entry-point-split.ts"
import { positionalToOptions } from "./positional-to-options.ts"
import { relativeJsExtensions } from "./relative-js-extensions.ts"
import { renameInterfaceProperty } from "./rename-interface-property.ts"
import { renamePackageImport } from "./rename-package-import.ts"
import { renameThroughBarrel } from "./rename-through-barrel.ts"
import { splitModule } from "./split-module.ts"

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
  readonly files: ReadonlyArray<{ readonly fileName: string; readonly action: string }>
  readonly diff: string
}

const defineExample = <Input, E, R>(example: {
  readonly id: string
  readonly fixture: string
  readonly recipe: Recipe<Input, E, R>
  readonly input: (project: Workspace.ConfiguredProject.Type) => Input
}) => ({
  id: example.id,
  fixture: example.fixture,
  execute: (project: Workspace.ConfiguredProject.Type) => {
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
    id: "as-assertion-to-satisfies",
    fixture: "fixtures/migrations/as-assertion-to-satisfies",
    recipe: asAssertionToSatisfies,
    input: () => undefined,
  }),
  defineExample({
    id: "rename-package-import",
    fixture: "fixtures/migrations/rename-package-import",
    recipe: renamePackageImport,
    input: () => undefined,
  }),
  defineExample({
    id: "package-entry-point-split",
    fixture: "fixtures/migrations/package-entry-point-split",
    recipe: packageEntryPointSplit,
    input: () => undefined,
  }),
  defineExample({
    id: "positional-to-options",
    fixture: "fixtures/migrations/positional-to-options",
    recipe: positionalToOptions,
    input: (project) => ({ project }),
  }),
  defineExample({
    id: "overloaded-method",
    fixture: "fixtures/migrations/overloaded-method",
    recipe: overloadedMethod,
    input: (project) => ({ project }),
  }),
  defineExample({
    id: "jsx-button-props",
    fixture: "fixtures/migrations/jsx-button-props",
    recipe: jsxButtonProps,
    input: () => undefined,
  }),
  defineExample({
    id: "rename-interface-property",
    fixture: "fixtures/migrations/rename-interface-property",
    recipe: renameInterfaceProperty,
    input: () => undefined,
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
    id: "split-module",
    fixture: "fixtures/migrations/split-module",
    recipe: splitModule,
    input: (project) => ({ project }),
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
    id: "enum-to-const-object",
    fixture: "fixtures/migrations/enum-to-const-object",
    recipe: enumToConstObject,
    input: (project) => ({
      project,
      declarationFile: ProjectRelativePath.schema.make("src/status.ts"),
      enumName: "Status",
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
  const workspace = destination === undefined ?
    yield* fs.makeTempDirectory({ prefix: `safemods-${path.basename(fixture)}-` }) :
    path.resolve(destination)
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
  const definition = yield* Workspace.WorkspaceDefinition.make({
    projects: [{ id: "app", config: "tsconfig.json" }],
  })
  const [project] = definition.projects
  const { verified } = yield* Effect.gen(function* () {
    const executed = yield* example.execute(project)
    if (!preview) {
      yield* applyVerifiedPlan(executed.verified)
    }
    return executed
  }).pipe(Effect.provide(Workspace.layer(definition, workspace)))
  yield* git(workspace, ["add", "-A"])
  const diff = yield* git(workspace, ["--no-pager", "diff", "--no-color", "HEAD"])
  return {
    id: example.id,
    fixture: NodePath.resolve(repoRoot, example.fixture),
    workspace,
    applied: !preview,
    files: verified.preview.files.map((file) => ({
      fileName: file.fileName,
      action: actionOf(file),
    })),
    diff,
  }
}, Effect.provide(NodeServices.layer))

const formatResult = (result: ExampleResult): string => {
  const lines = [
    `Example:    ${result.id}`,
    `Fixture:    ${result.fixture}  (unchanged)`,
    `Workspace:  ${result.workspace}`,
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

const isMain = process.argv[1] !== undefined &&
  NodePath.resolve(process.argv[1]) === import.meta.filename

if (isMain) {
  NodeRuntime.runMain(
    Command.run(command, { version: "0.2.0" }).pipe(Effect.provide(NodeServices.layer)),
  )
}
