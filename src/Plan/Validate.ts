import { Effect, Schema } from "effect"
import { compareEdits, editsConflict } from "../Edit/index.ts"
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

export const compareStrings = (left: string, right: string): number => left.localeCompare(right)

export const compareIds = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id.localeCompare(right.id)

export const compareSourceFingerprints = (
  left: SourceFingerprint,
  right: SourceFingerprint,
): number =>
  left.projectId.localeCompare(right.projectId) ||
  left.fileName.localeCompare(right.fileName) ||
  (left.kind ?? "file").localeCompare(right.kind ?? "file")

export const compareFileOperations = (
  left: PlannedFileOperation,
  right: PlannedFileOperation,
): number =>
  left.projectId.localeCompare(right.projectId) ||
  left.path.localeCompare(right.path) ||
  left.kind.localeCompare(right.kind)

const hasCanonicalOrder = <A>(
  values: ReadonlyArray<A>,
  compare: (left: A, right: A) => number,
): boolean => {
  for (let index = 1; index < values.length; index++) {
    if (compare(values[index - 1]!, values[index]!) > 0) return false
  }
  return true
}

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

const validateInputSemantics = (
  input: PlanInput,
  requireCanonicalOrder: boolean,
): Effect.Effect<void, PlanBuildError> =>
  Effect.gen(function* () {
    if (
      requireCanonicalOrder &&
      (!hasCanonicalOrder(input.projects, compareIds) ||
        !hasCanonicalOrder(input.sources, compareSourceFingerprints) ||
        !hasCanonicalOrder(input.edits, compareEdits) ||
        !hasCanonicalOrder(input.evidence, compareIds) ||
        (input.fileOperations !== undefined &&
          !hasCanonicalOrder(input.fileOperations, compareFileOperations)))
    ) {
      return yield* fail("invalid-plan", "Plan content is not in canonical order")
    }
    const projectIds = new Set<string>()
    for (const project of input.projects) {
      if (project.id.length === 0 || projectIds.has(project.id)) {
        return yield* fail(
          projectIds.has(project.id) ? "duplicate-project" : "invalid-plan",
          `Invalid project ${project.id}`,
        )
      }
      const configFileName = normalizedPath(project.configFileName)
      if (
        configFileName === undefined ||
        (requireCanonicalOrder && configFileName !== project.configFileName)
      ) {
        return yield* fail("invalid-path", project.configFileName)
      }
      projectIds.add(project.id)
    }
    const sourceMap = new Map<string, SourceFingerprint>()
    const seenSources = new Set<string>()
    for (const source of input.sources) {
      const path = normalizedPath(source.fileName)
      if (path === undefined || (requireCanonicalOrder && path !== source.fileName)) {
        return yield* fail("invalid-path", source.fileName)
      }
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
    const orderedEdits = requireCanonicalOrder ? input.edits : [...input.edits].sort(compareEdits)
    for (let index = 1; index < orderedEdits.length; index++) {
      if (editsConflict(orderedEdits[index - 1]!, orderedEdits[index]!)) {
        return yield* fail("edit-conflict", "Overlapping edits")
      }
    }
    for (const edit of input.edits) {
      const fileName = normalizedPath(edit.fileName)
      if (fileName === undefined || (requireCanonicalOrder && fileName !== edit.fileName)) {
        return yield* fail("invalid-path", edit.fileName)
      }
      if (requireCanonicalOrder && !hasCanonicalOrder(edit.evidenceIds, compareStrings)) {
        return yield* fail("invalid-plan", "Edit evidence IDs are not in canonical order")
      }
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
        if (path === undefined || (requireCanonicalOrder && path !== operation.path)) {
          return yield* fail("invalid-path", operation.path)
        }
        if (
          requireCanonicalOrder &&
          operation.kind === "move" &&
          normalizedPath(operation.toPath) !== operation.toPath
        ) {
          return yield* fail("invalid-path", operation.toPath)
        }
        const normalized =
          operation.kind === "move" && normalizedPath(operation.toPath) !== undefined
            ? { ...operation, path, toPath: normalizedPath(operation.toPath)! }
            : { ...operation, path }
        const error = validateOperation(normalized, projectIds, sourceMap, evidenceIds)
        if (
          requireCanonicalOrder &&
          normalized.evidenceIds !== undefined &&
          !hasCanonicalOrder(normalized.evidenceIds, compareStrings)
        ) {
          return yield* fail("invalid-plan", "File operation evidence IDs are not canonical")
        }
        if (error !== undefined) return yield* fail("invalid-file-operation", error)
        for (const key of operationKeys(normalized)) {
          if (occupied.has(key))
            return yield* fail("invalid-file-operation", `Conflicting file operation ${key}`)
          occupied.add(key)
        }
      }
    }
  })

export const validateInput = (input: PlanInput): Effect.Effect<void, PlanBuildError> =>
  Effect.gen(function* () {
    yield* validateInputStructure(input)
    yield* validateInputSemantics(input, false)
  })

export const validateDecodedPlan = (
  plan: TransformationPlan,
): Effect.Effect<void, PlanBuildError> => {
  const { schemaVersion: _, planId: __, snapshotHash: ___, ...input } = plan
  return validateInputSemantics(input, true)
}
