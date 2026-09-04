import { Layer } from "effect"
import { layer as platformLayer } from "../platform/node.ts"
import { workspaceRuntimeLayer } from "./WorkspaceRuntime.ts"

export { workspaceLayerNode } from "./WorkspaceRuntime.ts"

export const layer = Layer.mergeAll(platformLayer, workspaceRuntimeLayer)
