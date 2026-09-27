import { Schema } from "effect"
import * as ProjectId from "../../src/ProjectId.ts"
import * as WorkspacePath from "../../src/WorkspacePath.ts"

export const projectId = Schema.decodeSync(ProjectId.schema)
export const workspacePath = Schema.decodeSync(WorkspacePath.schema)
