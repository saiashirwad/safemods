import { Schema } from "effect"
import * as ProjectId from "../../src/ProjectId.ts"
import * as ProjectRelativePath from "../../src/ProjectRelativePath.ts"

export const projectId = Schema.decodeSync(ProjectId.schema)
export const projectPath = Schema.decodeSync(ProjectRelativePath.schema)
