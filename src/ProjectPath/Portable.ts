/** Portable project-relative path identity for durable values. */
import { Data } from "effect"

/** A canonical path which is safe to resolve below a project root. */
export type ProjectRelativePath = string & { readonly __projectRelativePath: unique symbol }

/** Minimal host-path operations needed for project containment. */
export interface ProjectPathOperations {
  readonly resolve: (...paths: ReadonlyArray<string>) => string
  readonly dirname: (path: string) => string
  readonly relative: (from: string, to: string) => string
  readonly isAbsolute: (path: string) => boolean
  readonly sep: string
}

export interface PathContainmentOptions {
  readonly includeRoot?: boolean
  readonly caseInsensitive?: boolean
}

export interface PlanProjectPaths {
  readonly projects: ReadonlyArray<{
    readonly id: string
    readonly configFileName: string
  }>
}

export interface ResolvedPlanFilePath {
  readonly projectRoot: string
  readonly fileName: string
}

export class InvalidProjectRelativePath extends Data.TaggedError("InvalidProjectRelativePath")<{
  readonly path: string
}> {}

const canonicalPath = (value: string): string | undefined => {
  if (value.length === 0 || value.includes("\0")) return undefined
  // Durable plans are portable, so reject POSIX and Windows absolute spellings.
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
    // A colon is a drive or device spelling on Windows. It is not portable.
    if (part.includes(":")) return undefined
    result.push(part)
  }
  return result.length === 0 ? undefined : result.join("/")
}

/** Convert a host path to slash-separated form relative to a project root. */
export const projectRelative = (
  path: ProjectPathOperations,
  root: string,
  absolute: string,
): string => path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join("/")

/** Parse and normalize a portable project-relative path. */
export const parseProjectRelativePath = (value: string): ProjectRelativePath | undefined => {
  const normalized = canonicalPath(value)
  // SAFETY: canonicalPath returns only normalized project-relative paths.
  return normalized as ProjectRelativePath | undefined
}

export const isProjectRelativePath = (value: string): value is ProjectRelativePath =>
  parseProjectRelativePath(value) === value

export const requireProjectRelativePath = (value: string): ProjectRelativePath => {
  const parsed = parseProjectRelativePath(value)
  if (parsed === undefined) throw new InvalidProjectRelativePath({ path: value })
  return parsed
}

/** True when `candidate` is below `root`, with explicit host comparison semantics. */
export const isPathContained = (
  path: ProjectPathOperations,
  root: string,
  candidate: string,
  options: PathContainmentOptions = {},
): boolean => {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const comparisonRoot =
    options.caseInsensitive === true ? resolvedRoot.toLowerCase() : resolvedRoot
  const comparisonCandidate =
    options.caseInsensitive === true ? resolvedCandidate.toLowerCase() : resolvedCandidate
  const relative = path.relative(comparisonRoot, comparisonCandidate)
  return (
    (relative !== "" || options.includeRoot === true) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** Resolve a relative path, or an already-absolute path, below a project root. */
export const resolveContainedProjectPath = (
  path: ProjectPathOperations,
  projectRoot: string,
  fileName: string,
  options: PathContainmentOptions = {},
): string | undefined => {
  const relative = parseProjectRelativePath(fileName)
  const absolute =
    relative !== undefined
      ? path.resolve(projectRoot, relative)
      : path.isAbsolute(fileName)
        ? path.resolve(fileName)
        : undefined
  return absolute !== undefined && isPathContained(path, projectRoot, absolute, options)
    ? absolute
    : undefined
}

/** Resolve one durable plan path below its configured project and workspace roots. */
export const resolvePlanFilePath = (
  path: ProjectPathOperations,
  plan: PlanProjectPaths,
  workspaceRoot: string,
  projectId: string,
  fileName: string,
): ResolvedPlanFilePath | undefined => {
  const project = plan.projects.find((candidate) => candidate.id === projectId)
  if (
    project === undefined ||
    !isProjectRelativePath(fileName) ||
    !isProjectRelativePath(project.configFileName)
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

/** Stable diagnostic for an invalid or unknown path in a durable plan. */
export const unsafePlanFilePathMessage = (projectId: string, fileName: string): string =>
  `Unsafe or unknown project path: ${projectId}:${fileName}`
