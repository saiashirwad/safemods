/**
 * Node composition boundary: the one module that touches Node APIs directly.
 *
 * Library code depends on `FileSystem.FileSystem`, `Path.Path`, and
 * `WorkspaceRuntime`; this module provides their Node implementations.
 */
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import * as Fs from "node:fs"
import { Effect, Layer, Option, Path } from "effect"
import type { APIOptions } from "typescript/unstable/async"
import type { WorkspaceDefinition } from "./Workspace/index.ts"
import { layer as workspaceLayer } from "./Workspace/Service.ts"
import { WorkspaceRuntime } from "./Workspace/Runtime.ts"

/** Synchronous compiler-host callbacks report failure as `undefined`. */
const orUndefined = <A, B>(f: (a: A) => B): ((a: A) => B | undefined) => {
  const lifted = Option.liftThrowable(f)
  return (a) => Option.getOrUndefined(lifted(a))
}

const workspaceRuntimeLayer = Layer.effect(
  WorkspaceRuntime,
  Effect.map(Path.Path, (path) =>
    WorkspaceRuntime.of({
      ...path,
      readFileText: orUndefined((path: string) => Fs.readFileSync(path, "utf8")),
      fileExists: orUndefined((path: string) => Fs.existsSync(path) && Fs.statSync(path).isFile()),
      directoryExists: orUndefined((path: string) => Fs.statSync(path).isDirectory()),
      directoryEntries: orUndefined((path: string) => {
        const entries = Fs.readdirSync(path, { withFileTypes: true })
        return {
          files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
          directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
        }
      }),
      realPath: orUndefined((path: string) => Fs.realpathSync(path)),
    }),
  ),
).pipe(Layer.provide(NodePath.layer))

export const workspaceLayerNode = (definition: WorkspaceDefinition, options: APIOptions = {}) =>
  workspaceLayer(definition, options).pipe(Layer.provide(workspaceRuntimeLayer))

/** Every Node service the library needs: filesystem, path, and workspace runtime. */
export const layer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, workspaceRuntimeLayer)
