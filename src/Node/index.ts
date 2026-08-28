import { Layer } from "effect"
import { layer as platformLayer } from "../platform/node.ts"
import { workspaceRuntimeLayer } from "./WorkspaceRuntime.ts"

export { workspaceLayerNode, workspaceRuntimeLayer } from "./WorkspaceRuntime.ts"
export { pathLayer } from "../platform/node.ts"

export const layer = Layer.mergeAll(platformLayer, workspaceRuntimeLayer)
