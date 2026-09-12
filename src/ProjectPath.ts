import type { Path } from "effect"
import type * as ProjectId from "./ProjectId.ts"
import type * as ProjectRelativePath from "./ProjectRelativePath.ts"

interface PathContainmentOptions {
  readonly includeRoot?: boolean
  readonly caseInsensitive?: boolean
}

interface PlanProjectPaths {
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId.Type
    readonly configFileName: ProjectRelativePath.Type
  }>
}

interface ResolvedPlanFilePath {
  readonly projectRoot: string
  readonly fileName: string
}

export const projectRelative = (path: Path.Path, root: string, absolute: string): string =>
  path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join("/")

export const isPathContained = (
  path: Path.Path,
  root: string,
  candidate: string,
  options: PathContainmentOptions = {},
): boolean => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const comparisonRoot =
    options.caseInsensitive === true ? resolvedRoot.toLocaleLowerCase("en-US") : resolvedRoot
  const comparisonCandidate =
    options.caseInsensitive === true
      ? resolvedCandidate.toLocaleLowerCase("en-US")
      : resolvedCandidate
  const relative = path.relative(comparisonRoot, comparisonCandidate)
  return (
    (relative !== "" || options.includeRoot === true) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export const resolvePlanFilePath = (
  path: Path.Path,
  plan: PlanProjectPaths,
  workspaceRoot: string,
  projectId: ProjectId.Type,
  fileName: ProjectRelativePath.Type,
): ResolvedPlanFilePath | undefined => {
  const project = plan.projects.find((candidate) => candidate.id === projectId)
  if (project === undefined) return undefined
  const root = path.resolve(workspaceRoot)
  const configFile = path.resolve(root, project.configFileName)
  const projectRoot = path.dirname(configFile)
  const target = path.resolve(projectRoot, fileName)
  const projectInsideWorkspace = projectRoot === root || isPathContained(path, root, projectRoot)
  if (!projectInsideWorkspace || !isPathContained(path, projectRoot, target)) return undefined
  return { projectRoot, fileName: target }
}

export const unsafePlanFilePathMessage = (projectId: string, fileName: string): string =>
  `Unsafe or unknown project path: ${projectId}:${fileName}`
