import * as Fs from "node:fs/promises"
import { layer as nodeLayer, workspaceLayerNode } from "../../src/Node.ts"
import { fileURLToPath } from "node:url"
import type { APIOptions } from "typescript/unstable/async"
import { Effect, Layer, type FileSystem, type Path } from "effect"
import {
  ConfiguredProject,
  type Workspace,
  WorkspaceDefinition,
} from "../../src/Workspace/index.ts"
import type { WorkspaceRuntime } from "../../src/Workspace/Runtime.ts"

const fixtureSource = fileURLToPath(new URL("../../fixtures/recipe/", import.meta.url))

export interface FixtureOptions {
  readonly fixturePath?: string
  readonly fs?: APIOptions["fs"]
}

export const withFixture = <A, E, R>(
  use: (root: string, app: ConfiguredProject.Type) => Effect.Effect<A, E, R>,
  options: FixtureOptions = {},
): Effect.Effect<
  A,
  unknown,
  Exclude<R, Workspace | WorkspaceRuntime | FileSystem.FileSystem | Path.Path>
> =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const root = await Fs.mkdtemp("/tmp/safemods-decl-")
      await Fs.cp(options.fixturePath ?? fixtureSource, root, { recursive: true })
      return root
    }),
    (root) =>
      Effect.gen(function* () {
        const app = yield* ConfiguredProject.make({ id: "app", config: "tsconfig.json" })
        const definition = yield* WorkspaceDefinition.make({ projects: [app] })
        const workspaceLayer = workspaceLayerNode(
          definition,
          options.fs === undefined ? { cwd: root } : { cwd: root, fs: options.fs },
        )
        const runtimeLayer = Layer.merge(workspaceLayer, nodeLayer)
        return yield* use(root, app).pipe(Effect.provide(runtimeLayer))
      }),
    (root) =>
      Effect.tryPromise(() => Fs.rm(root, { recursive: true, force: true })).pipe(Effect.ignore),
  )
