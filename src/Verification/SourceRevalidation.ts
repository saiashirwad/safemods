/** Project identity and source fingerprint revalidation. */
import { hash } from "node:crypto"
import { Effect, FileSystem, Path } from "effect"
import type { SourceFingerprint, TransformationPlan } from "../Plan/TransformationPlan.ts"
import { resolvePlanFilePath, unsafePlanFilePathMessage } from "../ProjectPath.ts"
import { ConfiguredProject } from "../Workspace/index.ts"
import { ProjectIdentityMismatch, StalePlanError, VerificationFailure } from "./Errors.ts"

/** Plan projects are already sorted by id (see Plan/Codec canonicalizeContent). */
export const requireMatchingProjectIdentity = (
  plan: TransformationPlan,
  liveProjects: ReadonlyArray<ConfiguredProject>,
): Effect.Effect<void, ProjectIdentityMismatch> => {
  const expected = [...liveProjects].sort((left, right) => left.id.localeCompare(right.id))
  const actual = plan.projects.map((project) =>
    ConfiguredProject.make({ id: project.id, config: project.configFileName }),
  )
  const same =
    expected.length === actual.length &&
    expected.every((p, i) => p.id === actual[i]!.id && p.config === actual[i]!.config)
  return same
    ? Effect.void
    : Effect.fail(new ProjectIdentityMismatch({ planId: plan.planId, expected, actual }))
}

export const absoluteTarget = (
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
    const stale = new StalePlanError({
      planId: plan.planId,
      projectId: source.projectId,
      fileName: source.fileName,
    })
    const absolute = yield* absoluteTarget(plan, workspaceRoot, source.projectId, source.fileName)
    const fs = yield* FileSystem.FileSystem
    if (source.kind === "missing") {
      const exists = yield* fs.exists(absolute).pipe(Effect.mapError(() => stale))
      if (exists) return yield* stale
      return undefined
    }
    const content = yield* fs.readFileString(absolute).pipe(Effect.mapError(() => stale))
    if (hash("sha256", content, "hex") !== source.hash) return yield* stale
    return content
  })
