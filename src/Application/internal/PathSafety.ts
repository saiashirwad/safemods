import { Effect, FileSystem, Path } from "effect"
import {
  isPathContained,
  resolvePlanFilePath,
  unsafePlanFilePathMessage,
} from "../../ProjectPath/index.ts"
import type { TransformationPlan } from "../../Plan/index.ts"
import { toApplicationFailure, type ApplicationFailureResult } from "./Failure.ts"

/**
 * Resolve a durable project-relative path and enforce both lexical and real
 * filesystem containment. The nearest existing parent check prevents a
 * symlinked directory from redirecting a valid-looking path outside the
 * project between plan decoding and application.
 */
export const safeTarget = (
  plan: TransformationPlan,
  workspaceRoot: string,
  projectId: string,
  fileName: string,
): Effect.Effect<string, ApplicationFailureResult, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const resolved = resolvePlanFilePath(path, plan, workspaceRoot, projectId, fileName)
    if (resolved === undefined) {
      return yield* toApplicationFailure(plan.planId)(
        unsafePlanFilePathMessage(projectId, fileName),
      )
    }
    const root = path.resolve(workspaceRoot)
    const { projectRoot, fileName: target } = resolved

    const realProjectRoot = yield* fs
      .realPath(projectRoot)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause)))
    const realWorkspaceRoot = yield* fs
      .realPath(root)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause)))
    if (!isPathContained(path, realWorkspaceRoot, realProjectRoot, { includeRoot: true })) {
      return yield* toApplicationFailure(plan.planId)(
        `Project root escapes workspace through symlink: ${projectId}`,
      )
    }
    let existingParent = path.dirname(target)
    while (
      !(yield* fs
        .exists(existingParent)
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause))))
    ) {
      if (existingParent === projectRoot) break
      const parent = path.dirname(existingParent)
      if (parent === existingParent || !isPathContained(path, projectRoot, parent)) {
        return yield* toApplicationFailure(plan.planId)(
          `Path escapes project through parent: ${fileName}`,
        )
      }
      existingParent = parent
    }
    const realParent = yield* fs
      .realPath(existingParent)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause)))
    if (!isPathContained(path, realProjectRoot, realParent, { includeRoot: true })) {
      return yield* toApplicationFailure(plan.planId)(
        `Path escapes project through symlink: ${fileName}`,
      )
    }

    const targetExists = yield* fs
      .exists(target)
      .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause)))
    if (targetExists) {
      const realTarget = yield* fs
        .realPath(target)
        .pipe(Effect.mapError((cause) => toApplicationFailure(plan.planId)(cause)))
      if (!isPathContained(path, realProjectRoot, realTarget)) {
        return yield* toApplicationFailure(plan.planId)(
          `Target escapes project through symlink: ${fileName}`,
        )
      }
    }
    return target
  })
