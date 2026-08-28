/** Structural and semantic Plan validation. */
import { Effect, Predicate, Schema } from "effect"
import { editsConflict } from "../Edit/index.ts"
import { virtualFileKey } from "../VirtualFs/index.ts"
import { parseProjectRelativePath, type ProjectRelativePath } from "../ProjectPath/index.ts"
import {
  isContentFingerprint,
  PlanBuildError,
  type PlannedFileOperation,
  type PlanInput,
  type SourceFingerprint,
  type TransformationPlan,
} from "./TransformationPlan.ts"
import { PlanInputSchema, strictPlanParseOptions } from "./Structure.ts"

const fail = (
  reason: PlanBuildError["reason"],
  detail: string,
): Effect.Effect<never, PlanBuildError> => Effect.fail(new PlanBuildError({ reason, detail }))

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- numeric I/O guard before Schema decode.
const isFiniteNonnegativeInteger = (value: unknown): value is number =>
  Predicate.isNumber(value) && Number.isFinite(value) && Number.isInteger(value) && value >= 0

const decodePlanInput = Schema.decodeUnknownEffect(PlanInputSchema, strictPlanParseOptions)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plan finalize I/O boundary; Schema is the parser.
const validateInputStructure = (input: unknown): Effect.Effect<void, PlanBuildError> =>
  decodePlanInput(input).pipe(
    Effect.asVoid,
    Effect.mapError(
      () => new PlanBuildError({ reason: "invalid-plan", detail: "Plan shape is invalid" }),
    ),
  )

export const normalizedPath = (value: string): ProjectRelativePath | undefined =>
  parseProjectRelativePath(value)

const operationKeys = (operation: PlannedFileOperation): Array<string> => {
  const keys = [virtualFileKey(operation.projectId, operation.path)]
  if (operation.kind === "move") keys.push(virtualFileKey(operation.projectId, operation.toPath))
  return keys
}

const validateOperation = (
  operation: PlannedFileOperation,
  projects: ReadonlySet<string>,
  sources: ReadonlyMap<string, SourceFingerprint>,
  evidence: ReadonlySet<string>,
): string | undefined => {
  if (!projects.has(operation.projectId)) return `Unknown project ${operation.projectId}`
  if (normalizedPath(operation.path) === undefined) return `Invalid path ${operation.path}`
  for (const id of operation.evidenceIds ?? [])
    if (!evidence.has(id)) return `Unknown evidence ${id}`
  const source = sources.get(virtualFileKey(operation.projectId, operation.path))
  if (operation.kind === "create") {
    if (source !== undefined) return `Create path already exists: ${operation.path}`
  } else {
    if (source === undefined) return `Missing source ${operation.path}`
    if (operation.initialHash !== source.hash) return `Fingerprint mismatch ${operation.path}`
    if (operation.kind === "move") {
      if (normalizedPath(operation.toPath) === undefined)
        return `Invalid target path ${operation.toPath}`
      if (operation.toPath === operation.path) return "Move source and target must differ"
      if (sources.has(virtualFileKey(operation.projectId, operation.toPath)))
        return `Move target exists: ${operation.toPath}`
    }
  }
  return undefined
}

const validateInputSemantics = (input: PlanInput): Effect.Effect<void, PlanBuildError> =>
  Effect.gen(function* () {
    const projectIds = new Set<string>()
    for (const project of input.projects) {
      if (project.id.length === 0 || projectIds.has(project.id)) {
        return yield* fail(
          projectIds.has(project.id) ? "duplicate-project" : "invalid-plan",
          `Invalid project ${project.id}`,
        )
      }
      if (normalizedPath(project.configFileName) === undefined) {
        return yield* fail("invalid-path", project.configFileName)
      }
      projectIds.add(project.id)
    }
    const sourceMap = new Map<string, SourceFingerprint>()
    const seenSources = new Set<string>()
    for (const source of input.sources) {
      const path = normalizedPath(source.fileName)
      if (path === undefined) return yield* fail("invalid-path", source.fileName)
      if (!projectIds.has(source.projectId)) return yield* fail("missing-source", source.fileName)
      const kind = source.kind ?? "file"
      const unique = `${source.projectId}\0${kind}\0${path}`
      if (seenSources.has(unique)) return yield* fail("duplicate-source", source.fileName)
      seenSources.add(unique)
      const normalized = { ...source, fileName: path }
      if (isContentFingerprint(normalized))
        sourceMap.set(virtualFileKey(source.projectId, path), normalized)
    }
    const evidenceIds = new Set<string>()
    for (const item of input.evidence) {
      if (item.id.length === 0 || evidenceIds.has(item.id)) {
        return yield* fail("duplicate-evidence", `Evidence IDs must be unique: ${item.id}`)
      }
      evidenceIds.add(item.id)
    }
    for (const edit of input.edits) {
      if (
        !isFiniteNonnegativeInteger(edit.start) ||
        !isFiniteNonnegativeInteger(edit.end) ||
        edit.end < edit.start
      ) {
        return yield* fail("invalid-edit", `${edit.fileName}:${edit.start}`)
      }
      const fileName = normalizedPath(edit.fileName)
      if (fileName === undefined) return yield* fail("invalid-path", edit.fileName)
      if (
        !projectIds.has(edit.projectId) ||
        !sourceMap.has(virtualFileKey(edit.projectId, fileName))
      ) {
        return yield* fail("missing-source", edit.fileName)
      }
      for (const id of edit.evidenceIds)
        if (!evidenceIds.has(id)) return yield* fail("missing-evidence", id)
    }
    if (input.fileOperations !== undefined) {
      const occupied = new Set<string>()
      for (const operation of input.fileOperations) {
        const path = normalizedPath(operation.path)
        if (path === undefined) return yield* fail("invalid-path", operation.path)
        const normalized =
          operation.kind === "move" && normalizedPath(operation.toPath) !== undefined
            ? { ...operation, path, toPath: normalizedPath(operation.toPath)! }
            : { ...operation, path }
        const error = validateOperation(normalized, projectIds, sourceMap, evidenceIds)
        if (error !== undefined) return yield* fail("invalid-file-operation", error)
        for (const key of operationKeys(normalized)) {
          if (occupied.has(key))
            return yield* fail("invalid-file-operation", `Conflicting file operation ${key}`)
          occupied.add(key)
        }
      }
    }
    const { min, max } = input.policies.matchCount
    if (
      (min !== undefined && !isFiniteNonnegativeInteger(min)) ||
      (max !== undefined && !isFiniteNonnegativeInteger(max)) ||
      (min !== undefined && max !== undefined && min > max) ||
      (input.policies.maxAffectedFiles !== undefined &&
        !isFiniteNonnegativeInteger(input.policies.maxAffectedFiles)) ||
      (input.measurements?.matches !== undefined &&
        !isFiniteNonnegativeInteger(input.measurements.matches))
    ) {
      return yield* fail(
        "invalid-policy",
        "Policy counts must be finite nonnegative integers with min <= max",
      )
    }
  })

export const validateInput = (input: PlanInput): Effect.Effect<void, PlanBuildError> =>
  Effect.gen(function* () {
    yield* validateInputStructure(input)
    yield* validateInputSemantics(input)
  })

export const validateDecodedPlan = (
  plan: TransformationPlan,
): Effect.Effect<void, PlanBuildError> =>
  Effect.gen(function* () {
    const { schemaVersion: _, planId: __, snapshotHash: ___, ...input } = plan
    yield* validateInputSemantics(input)
    for (let index = 1; index < plan.edits.length; index++) {
      if (editsConflict(plan.edits[index - 1]!, plan.edits[index]!))
        return yield* fail("edit-conflict", "Overlapping edits")
    }
  })
