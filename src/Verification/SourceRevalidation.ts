/** Project identity and source fingerprint revalidation. */
import { Effect, FileSystem, Path } from "effect"
import { hashDirectoryListing, sha256 } from "../Edit/Hash.ts"
import type { SourceFingerprint, TransformationPlan } from "../Plan/index.ts"
import {
  parseProjectRelativePath,
  resolvePlanFilePath,
  unsafePlanFilePathMessage,
} from "../ProjectPath/index.ts"
import { ProjectIdentityMismatch, StalePlanError, VerificationFailure } from "./Errors.ts"

const liveProjectIdentities = (
  projects: ReadonlyArray<{ readonly id: string; readonly config: string }>,
): ReadonlyArray<{ readonly id: string; readonly config: string }> =>
  [...projects].sort((left, right) => left.id.localeCompare(right.id))

const planProjectIdentities = (
  plan: TransformationPlan,
): ReadonlyArray<{ readonly id: string; readonly config: string }> =>
  [...plan.projects]
    .map((project) => ({ id: project.id, config: project.configFileName }))
    .sort((left, right) => left.id.localeCompare(right.id))

const sameIdentities = (
  expected: ReadonlyArray<{ readonly id: string; readonly config: string }>,
  actual: ReadonlyArray<{ readonly id: string; readonly config: string }>,
): boolean =>
  expected.length === actual.length &&
  expected.every((project, index) => {
    const counterpart = actual[index]
    if (counterpart === undefined) return false
    return project.id === counterpart.id && project.config === counterpart.config
  })

export const requireMatchingProjectIdentity = (
  plan: TransformationPlan,
  liveProjects: ReadonlyArray<{ readonly id: string; readonly config: string }>,
): Effect.Effect<void, ProjectIdentityMismatch> => {
  const expected = liveProjectIdentities(liveProjects)
  const actual = planProjectIdentities(plan)
  if (sameIdentities(expected, actual)) return Effect.void
  return Effect.fail(new ProjectIdentityMismatch({ planId: plan.planId, expected, actual }))
}

const absoluteFileName = (
  plan: TransformationPlan,
  workspaceRoot: string,
  projectId: string,
  fileName: string,
): Effect.Effect<string, VerificationFailure, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const resolved = resolvePlanFilePath(path, plan, workspaceRoot, projectId, fileName)
    if (resolved === undefined) {
      return yield* new VerificationFailure({
        planId: plan.planId,
        policy: "edits",
        detail: unsafePlanFilePathMessage(projectId, fileName),
      })
    }
    return resolved.fileName
  })

const staleSource = (planId: string, source: SourceFingerprint): StalePlanError =>
  new StalePlanError({
    planId,
    projectId: source.projectId,
    fileName: source.fileName,
  })

export const revalidateSource = (
  plan: TransformationPlan,
  workspaceRoot: string,
  source: SourceFingerprint,
): Effect.Effect<
  string | undefined,
  StalePlanError | VerificationFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const stale = staleSource(plan.planId, source)
    const absolute = yield* absoluteFileName(plan, workspaceRoot, source.projectId, source.fileName)
    const fs = yield* FileSystem.FileSystem
    if (source.kind === "missing") {
      const exists = yield* fs.exists(absolute).pipe(Effect.mapError(() => stale))
      if (exists) return yield* stale
      return undefined
    }
    if (source.kind === "directory") {
      const names = yield* fs.readDirectory(absolute).pipe(Effect.mapError(() => stale))
      if (hashDirectoryListing(names) !== source.hash) return yield* stale
      return undefined
    }
    if (source.kind === "realpath") {
      const resolved = yield* fs.realPath(absolute).pipe(Effect.mapError(() => stale))
      const project = plan.projects.find((candidate) => candidate.id === source.projectId)
      if (project === undefined) return yield* stale
      const path = yield* Path.Path
      const projectRoot = path.resolve(workspaceRoot, path.dirname(project.configFileName))
      const realRoot = yield* fs.realPath(projectRoot).pipe(Effect.orElseSucceed(() => projectRoot))
      const relative = parseProjectRelativePath(
        path.relative(realRoot, resolved).split(path.sep).join("/"),
      )
      if (relative === undefined || sha256(relative) !== source.hash) return yield* stale
      return undefined
    }
    const content = yield* fs.readFileString(absolute).pipe(Effect.mapError(() => stale))
    if (sha256(content) !== source.hash) return yield* stale
    return content
  })

export const revalidatePlanSources = (
  plan: TransformationPlan,
  workspaceRoot: string,
): Effect.Effect<void, StalePlanError | VerificationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    for (const source of plan.sources) {
      yield* revalidateSource(plan, workspaceRoot, source)
    }
  })
