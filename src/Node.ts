/**
 * Node composition boundary: the one module that touches Node APIs directly.
 *
 * Library code depends on `FileSystem.FileSystem`, `Path.Path`, and
 * `WorkspaceRuntime`; this module provides their Node implementations.
 */
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as Fs from "node:fs"
import { Effect, Layer, Path, UndefinedOr } from "effect"
import type { APIOptions } from "typescript/unstable/async"
import type * as WorkspaceDefinition from "./Workspace/WorkspaceDefinition.ts"
import { layer as workspaceLayer } from "./Workspace/Service.ts"
import { WorkspaceRuntime } from "./Workspace/Runtime.ts"

const workspaceRuntimeLayer = Layer.effect(
  WorkspaceRuntime,
  Effect.map(Path.Path, (path) =>
    WorkspaceRuntime.of({
      ...path,
      directoryEntries: UndefinedOr.liftThrowable((path: string) => {
        const entries = Fs.readdirSync(path, { withFileTypes: true })
        return {
          files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
          directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
        }
      }),
      realPath: UndefinedOr.liftThrowable((path: string) => Fs.realpathSync(path)),
    }),
  ),
).pipe(Layer.provide(NodePath.layer))

export const workspaceLayerNode = (
  definition: WorkspaceDefinition.Type,
  options: APIOptions = {},
) => workspaceLayer(definition, options).pipe(Layer.provide(workspaceRuntimeLayer))

/** Every Node service the library needs: filesystem, path, and workspace runtime. */
export const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, workspaceRuntimeLayer)
