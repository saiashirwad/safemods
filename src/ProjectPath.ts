import { type Brand, Data, type Path } from "effect"

export type ProjectRelativePath = Brand.Branded<string, "ProjectRelativePath">

interface PathContainmentOptions {
  readonly includeRoot?: boolean
  readonly caseInsensitive?: boolean
}

interface PlanProjectPaths {
  readonly projects: ReadonlyArray<{
    readonly id: string
    readonly configFileName: string
  }>
}

interface ResolvedPlanFilePath {
  readonly projectRoot: string
  readonly fileName: string
}

export class InvalidProjectRelativePath extends Data.TaggedError("InvalidProjectRelativePath")<{
  readonly path: string
}> {}

const canonicalPath = (value: string): string | undefined => {
  if (value.length === 0 || value.includes("\0")) return undefined
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value))
    return undefined
  const parts = value.replaceAll("\\", "/").split("/")
  const result: Array<string> = []
  for (const part of parts) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (result.length === 0) return undefined
      result.pop()
      continue
    }
    if (part.includes(":")) return undefined
    result.push(part)
  }
  return result.length === 0 ? undefined : result.join("/")
}

export const projectRelative = (path: Path.Path, root: string, absolute: string): string =>
  path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join("/")

export const parseProjectRelativePath = (value: string): ProjectRelativePath | undefined => {
  const normalized = canonicalPath(value)
  // SAFETY: canonicalPath returns only normalized project-relative paths.
  return normalized as ProjectRelativePath | undefined
}

export const requireProjectRelativePath = (value: string): ProjectRelativePath => {
  const parsed = parseProjectRelativePath(value)
  if (parsed === undefined) throw new InvalidProjectRelativePath({ path: value })
  return parsed
}

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
  projectId: string,
  fileName: string,
): ResolvedPlanFilePath | undefined => {
  const project = plan.projects.find((candidate) => candidate.id === projectId)
  if (
    project === undefined ||
    parseProjectRelativePath(fileName) !== fileName ||
    parseProjectRelativePath(project.configFileName) !== project.configFileName
  ) {
    return undefined
  }
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
