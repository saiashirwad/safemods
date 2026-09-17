import * as Fs from "node:fs/promises"
import * as Os from "node:os"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import {
  type ConfiguredProject,
  layer as workspaceLayer,
  type ProjectSnapshot,
  Workspace,
  WorkspaceDefinition,
  WorkspaceSnapshot,
} from "../../src/Workspace/index.ts"

export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../fixtures/${name}/`, import.meta.url))

export const fixtureProject = (app: ConfiguredProject.Type) =>
  WorkspaceSnapshot.use((snapshot) => snapshot.project(app.id))

export const withFixture = <A, E, R>(
  use: (root: string, app: ConfiguredProject.Type) => Effect.Effect<A, E, R>,
  options: { readonly fixture?: string; readonly files?: Record<string, string> } = {},
): Effect.Effect<A, unknown, Exclude<R, Workspace | NodeServices.NodeServices>> =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const root = await Fs.mkdtemp(Path.join(Os.tmpdir(), "safemods-test-"))
      if (options.fixture !== "empty") {
        await Fs.cp(fixturePath(options.fixture ?? "recipe"), root, { recursive: true })
      }
      await Promise.all(
        Object.entries(options.files ?? {}).map(async ([fileName, content]) => {
          await Fs.mkdir(Path.dirname(Path.join(root, fileName)), { recursive: true })
          await Fs.writeFile(Path.join(root, fileName), content)
        }),
      )
      return root
    }),
    (root) =>
      Effect.gen(function* () {
        const definition = yield* WorkspaceDefinition.make({
          projects: [{ id: "app", config: "tsconfig.json" }],
        })
        return yield* use(root, definition.projects[0]).pipe(
          Effect.provide(Layer.merge(workspaceLayer(definition, root), NodeServices.layer)),
        )
      }),
    (root) => Effect.promise(() => Fs.rm(root, { recursive: true, force: true })),
  )

export const withProject = <A, E, R>(
  files: Record<string, string>,
  use: (project: ProjectSnapshot) => Effect.Effect<A, E, R>,
) =>
  withFixture(
    (_, app) =>
      Workspace.use((workspace) =>
        workspace.withSnapshot(Effect.flatMap(fixtureProject(app), use)),
      ),
    { files },
  )

export const read = (root: string, fileName: string): Effect.Effect<string> =>
  Effect.promise(() => Fs.readFile(Path.join(root, fileName), "utf8"))

export const write = (root: string, fileName: string, content: string): Effect.Effect<void> =>
  Effect.promise(() => Fs.writeFile(Path.join(root, fileName), content))

export const exists = (root: string, fileName: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    Fs.stat(Path.join(root, fileName)).then(
      () => true,
      () => false,
    ),
  )
