import { nodeFsPromises as Fs } from "../platform/node.ts"
import { fileURLToPath } from "node:url"
import type { APIOptions } from "typescript/unstable/async"
import { Effect, Layer, type FileSystem, type Path } from "effect"
import { layer as nodeLayer, workspaceLayerNode } from "../Node/index.ts"
import { ConfiguredProject, type Workspace, type WorkspaceRuntime } from "../Workspace/index.ts"

const fixtureSource = fileURLToPath(new URL("../../fixtures/recipe/", import.meta.url))

export interface FixtureOptions {
  readonly fixturePath?: string
  readonly fs?: APIOptions["fs"]
  readonly temporaryPrefix?: string
}

export const withFixture = <A, E, R>(
  use: (root: string, app: ConfiguredProject) => Effect.Effect<A, E, R>,
  options: FixtureOptions = {},
): Effect.Effect<
  A,
  unknown,
  Exclude<R, Workspace | WorkspaceRuntime | FileSystem.FileSystem | Path.Path>
> =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const root = await Fs.mkdtemp(options.temporaryPrefix ?? "/tmp/safemods-decl-")
      await Fs.cp(options.fixturePath ?? fixtureSource, root, { recursive: true })
      return root
    }),
    (root) => {
      const app = ConfiguredProject.make({ id: "app", config: "tsconfig.json" })
      const workspaceLayer = workspaceLayerNode(
        { projects: [app] },
        options.fs === undefined ? { cwd: root } : { cwd: root, fs: options.fs },
      )
      const runtimeLayer = Layer.merge(workspaceLayer, nodeLayer)
      return use(root, app).pipe(Effect.provide(runtimeLayer))
    },
    (root) =>
      Effect.tryPromise(() => Fs.rm(root, { recursive: true, force: true })).pipe(Effect.ignore),
  )
