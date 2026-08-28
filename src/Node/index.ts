import { Layer } from "effect"
import { layer as platformLayer } from "../platform/node.ts"
import { workspaceRuntimeLayer } from "./WorkspaceRuntime.ts"

export {
  isWithinProject,
  resolveContainedSnapshotPath,
  resolveProjectRelativeFile,
} from "./ProjectPath.ts"
export { workspaceLayerNode, workspaceRuntimeLayer } from "./WorkspaceRuntime.ts"
export { nodeFsPromises, path, pathLayer } from "../platform/node.ts"

/** Node runtime services, including Workspace's synchronous compiler host. */
export const layer = Layer.mergeAll(platformLayer, workspaceRuntimeLayer)
