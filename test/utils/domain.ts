import { Schema } from "effect"
import * as ProjectId from "../../src/ProjectId.ts"
import * as ProjectRelativePath from "../../src/ProjectRelativePath.ts"
import * as Sha256 from "../../src/Sha256.ts"
import * as ConfiguredProject from "../../src/Workspace/ConfiguredProject.ts"
import * as WorkspaceDefinition from "../../src/Workspace/WorkspaceDefinition.ts"

export const projectId = Schema.decodeSync(ProjectId.schema)
export const projectPath = Schema.decodeSync(ProjectRelativePath.schema)
export const sha256 = Schema.decodeSync(Sha256.schema)
export const configuredProject = Schema.decodeSync(ConfiguredProject.schema)
export const workspaceDefinition = Schema.decodeSync(WorkspaceDefinition.schema)
