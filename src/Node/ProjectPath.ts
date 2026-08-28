/** Node host-path resolution and project containment. */
import { path as Path } from "../platform/node.ts"
import {
  isPathContained,
  parseProjectRelativePath,
  resolveContainedProjectPath,
} from "../ProjectPath/index.ts"

/** True when `fileName` is a descendant of `projectRoot`. */
export const isWithinProject = (projectRoot: string, fileName: string): boolean =>
  isPathContained(Path, projectRoot, fileName)

/** Resolve a project-relative path that stays inside `projectRoot`. */
export const resolveProjectRelativeFile = (
  projectRoot: string,
  fileName: string,
): string | undefined => {
  const relative = parseProjectRelativePath(fileName)
  return relative === undefined
    ? undefined
    : resolveContainedProjectPath(Path, projectRoot, relative)
}

/**
 * Resolve a snapshot lookup path. Accept project-relative inputs and absolute
 * compiler paths that are already in the project.
 */
export const resolveContainedSnapshotPath = (
  projectRoot: string,
  fileName: string,
): string | undefined => resolveContainedProjectPath(Path, projectRoot, fileName)
