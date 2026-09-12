/**
 * The durable, content-addressed plan artifact.
 *
 * finalizePlan(input)  = decode → canonicalize → check semantics → stamp hashes
 * validatePlan(plan)   = decode → finalizePlan(content) → must reproduce the plan exactly
 * parsePlan(text)      = JSON → validatePlan → text must be the canonical serialization
 */
import { hash } from "node:crypto"
import { Data, Effect, Order, Schema } from "effect"
import { compareEdits, editsConflict, NonNegativeInt, TextEdit } from "./Edit.ts"
import { canonicalJson, EvidenceRecord } from "./Evidence.ts"
import { parseProjectRelativePath, requireProjectRelativePath } from "./ProjectPath.ts"
import { virtualFileKey } from "./VirtualFs.ts"

export type { TextEdit } from "./Edit.ts"
export type { EvidenceRecord } from "./Evidence.ts"
export type { ProjectRelativePath } from "./ProjectPath.ts"

// ---------------------------------------------------------------------------
// Schema

export const SourceFingerprint = Schema.Struct({
  projectId: Schema.String,
  fileName: Schema.String,
  hash: Schema.String,
  kind: Schema.Literals(["file", "missing"]),
})
export type SourceFingerprint = typeof SourceFingerprint.Type

const EvidenceIds = Schema.Array(Schema.String)

export const PlannedFileOperation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    projectId: Schema.String,
    path: Schema.String,
    content: Schema.String,
    evidenceIds: EvidenceIds,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete"),
    projectId: Schema.String,
    path: Schema.String,
    initialHash: Schema.String,
    evidenceIds: EvidenceIds,
  }),
  Schema.Struct({
    kind: Schema.Literal("move"),
    projectId: Schema.String,
    path: Schema.String,
    toPath: Schema.String,
    content: Schema.optional(Schema.String),
    initialHash: Schema.String,
    evidenceIds: EvidenceIds,
  }),
])
export type PlannedFileOperation = typeof PlannedFileOperation.Type

export const PlanPolicies = Schema.Struct({
  matchCount: Schema.Struct({
    min: Schema.optional(NonNegativeInt),
    max: Schema.optional(NonNegativeInt),
  }).check(
    Schema.makeFilter(
      (count) => count.min === undefined || count.max === undefined || count.min <= count.max,
      { expected: "matchCount.min <= matchCount.max" },
    ),
  ),
  maxAffectedFiles: Schema.optional(NonNegativeInt),
  diagnostics: Schema.Literals(["no-new-errors", "allow-new-errors"]),
  idempotence: Schema.Literals(["required", "not-promised"]),
})
export type PlanPolicies = typeof PlanPolicies.Type

const planContentFields = {
  recipe: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    implementationHash: Schema.String,
    options: Schema.Json,
  }),
  toolchain: Schema.Struct({
    systemVersion: Schema.String,
    typescriptVersion: Schema.String,
    effectVersion: Schema.String,
  }),
  projects: Schema.Array(Schema.Struct({ id: Schema.String, configFileName: Schema.String })),
  sources: Schema.Array(SourceFingerprint),
  edits: Schema.Array(TextEdit),
  fileOperations: Schema.Array(PlannedFileOperation),
  evidence: Schema.Array(EvidenceRecord),
  policies: PlanPolicies,
  measurements: Schema.Struct({ matches: NonNegativeInt }),
}

export const PlanInput = Schema.Struct(planContentFields)
export type PlanInput = typeof PlanInput.Type

export const TransformationPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: Schema.String,
  ...planContentFields,
  snapshotHash: Schema.String,
})
export type TransformationPlan = typeof TransformationPlan.Type

/** A plan that passed validatePlan. Only this module can produce one. */
declare const ValidatedPlanTypeId: unique symbol
export type ValidatedPlan = TransformationPlan & { readonly [ValidatedPlanTypeId]: true }

export class PlanBuildError extends Data.TaggedError("PlanBuildError")<{
  readonly detail: string
}> {}

export class PlanDecodeError extends Data.TaggedError("PlanDecodeError")<{
  readonly detail: string
}> {}

// ---------------------------------------------------------------------------
// Canonical form and hashes

const strict = { onExcessProperty: "error" } as const

const canonical = (
  value: PlanInput | TransformationPlan | Pick<PlanInput, "projects" | "sources">,
): string =>
  // SAFETY: plan schemas contain only JSON values.
  canonicalJson(value as Schema.Json)

export const serializePlan = (plan: TransformationPlan): string => canonical(plan)

export const snapshotHashOf = ({
  projects,
  sources,
}: Pick<PlanInput, "projects" | "sources">): string =>
  hash("sha256", canonical({ projects, sources }), "hex")

export const planHashOf = (plan: TransformationPlan): string => {
  const { planId: _, ...content } = plan
  return hash("sha256", canonical(content), "hex")
}

const allPaths = (input: PlanInput): ReadonlyArray<string> => [
  ...input.projects.map((project) => project.configFileName),
  ...input.sources.map((source) => source.fileName),
  ...input.edits.map((edit) => edit.fileName),
  ...input.fileOperations.flatMap((operation) =>
    operation.kind === "move" ? [operation.path, operation.toPath] : [operation.path],
  ),
]

/** Normalize every path and sort every array. Requires allPaths(input) to be valid. */
const canonicalize = (input: PlanInput): PlanInput => {
  const path = requireProjectRelativePath
  return {
    ...input,
    projects: input.projects
      .map((project) => ({ ...project, configFileName: path(project.configFileName) }))
      .sort(Order.Struct({ id: Order.String })),
    sources: input.sources
      .map((source) => ({ ...source, fileName: path(source.fileName) }))
      .sort(Order.Struct({ projectId: Order.String, fileName: Order.String, kind: Order.String })),
    edits: input.edits
      .map((edit) => ({
        ...edit,
        fileName: path(edit.fileName),
        evidenceIds: [...edit.evidenceIds].sort(Order.String),
      }))
      .sort(compareEdits),
    evidence: [...input.evidence].sort(Order.Struct({ id: Order.String })),
    fileOperations: input.fileOperations
      .map((operation) =>
        operation.kind === "move"
          ? {
              ...operation,
              path: path(operation.path),
              toPath: path(operation.toPath),
              evidenceIds: [...operation.evidenceIds].sort(Order.String),
            }
          : {
              ...operation,
              path: path(operation.path),
              evidenceIds: [...operation.evidenceIds].sort(Order.String),
            },
      )
      .sort(Order.Struct({ projectId: Order.String, path: Order.String, kind: Order.String })),
  }
}

// ---------------------------------------------------------------------------
// Semantic checks (run on canonical input)

const checkSemantics = (input: PlanInput): PlanBuildError | undefined => {
  const projectIds = new Set<string>()
  for (const project of input.projects) {
    if (project.id.length === 0 || projectIds.has(project.id)) {
      return new PlanBuildError({ detail: `Invalid project ${project.id}` })
    }
    projectIds.add(project.id)
  }

  const contentSources = new Map<string, SourceFingerprint>()
  const seenSources = new Set<string>()
  for (const source of input.sources) {
    if (!projectIds.has(source.projectId))
      return new PlanBuildError({ detail: `Unknown project ${source.projectId}` })
    const identity = `${source.projectId}\0${source.kind}\0${source.fileName}`
    if (seenSources.has(identity))
      return new PlanBuildError({ detail: `Duplicate source ${source.fileName}` })
    seenSources.add(identity)
    if (source.kind === "file") {
      contentSources.set(virtualFileKey(source.projectId, source.fileName), source)
    }
  }

  const evidenceIds = new Set<string>()
  for (const item of input.evidence) {
    if (item.id.length === 0 || evidenceIds.has(item.id)) {
      return new PlanBuildError({ detail: `Evidence IDs must be unique: ${item.id}` })
    }
    evidenceIds.add(item.id)
  }

  for (let index = 1; index < input.edits.length; index++) {
    if (editsConflict(input.edits[index - 1]!, input.edits[index]!)) {
      return new PlanBuildError({ detail: "Overlapping edits" })
    }
  }
  for (const edit of input.edits) {
    if (!contentSources.has(virtualFileKey(edit.projectId, edit.fileName))) {
      return new PlanBuildError({ detail: `Missing source ${edit.fileName}` })
    }
    const missing = edit.evidenceIds.find((id) => !evidenceIds.has(id))
    if (missing !== undefined) return new PlanBuildError({ detail: `Unknown evidence ${missing}` })
  }

  const occupied = new Set<string>()
  for (const operation of input.fileOperations) {
    if (!projectIds.has(operation.projectId)) {
      return new PlanBuildError({ detail: `Unknown project ${operation.projectId}` })
    }
    const missing = operation.evidenceIds.find((id) => !evidenceIds.has(id))
    if (missing !== undefined) return new PlanBuildError({ detail: `Unknown evidence ${missing}` })
    const key = virtualFileKey(operation.projectId, operation.path)
    const source = contentSources.get(key)
    const keys = [key]
    if (operation.kind === "create") {
      if (source !== undefined)
        return new PlanBuildError({ detail: `Create path already exists: ${operation.path}` })
    } else {
      if (source === undefined)
        return new PlanBuildError({ detail: `Missing source ${operation.path}` })
      if (operation.initialHash !== source.hash) {
        return new PlanBuildError({ detail: `Fingerprint mismatch ${operation.path}` })
      }
      if (operation.kind === "move") {
        if (operation.toPath === operation.path) {
          return new PlanBuildError({ detail: "Move source and target must differ" })
        }
        const target = virtualFileKey(operation.projectId, operation.toPath)
        if (contentSources.has(target))
          return new PlanBuildError({ detail: `Move target exists: ${operation.toPath}` })
        keys.push(target)
      }
    }
    for (const touched of keys) {
      if (occupied.has(touched))
        return new PlanBuildError({ detail: `Conflicting file operation ${touched}` })
      occupied.add(touched)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Entry points

export const finalizePlan = (input: PlanInput): Effect.Effect<TransformationPlan, PlanBuildError> =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(
      PlanInput,
      strict,
    )(input).pipe(Effect.mapError(() => new PlanBuildError({ detail: "Plan shape is invalid" })))
    const invalidPath = allPaths(input).find((path) => parseProjectRelativePath(path) === undefined)
    if (invalidPath !== undefined)
      return yield* new PlanBuildError({ detail: `Invalid path ${invalidPath}` })
    const content = canonicalize(input)
    const error = checkSemantics(content)
    if (error !== undefined) return yield* error
    const provisional: TransformationPlan = {
      schemaVersion: 1,
      planId: "",
      ...content,
      snapshotHash: snapshotHashOf(content),
    }
    return { ...provisional, planId: planHashOf(provisional) }
  })

/** A plan is valid iff re-finalizing its content reproduces it byte for byte. */
export const validatePlan = (
  plan: TransformationPlan,
): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(
      TransformationPlan,
      strict,
    )(plan).pipe(Effect.mapError(() => new PlanDecodeError({ detail: "Plan shape is invalid" })))
    const { schemaVersion: _, planId: __, snapshotHash: ___, ...content } = plan
    const rebuilt = yield* finalizePlan(content).pipe(
      Effect.mapError((error) => new PlanDecodeError({ detail: error.detail })),
    )
    if (serializePlan(rebuilt) !== serializePlan(plan)) {
      return yield* new PlanDecodeError({ detail: "Plan is not canonical or its hashes are wrong" })
    }
    // SAFETY: the plan is byte-for-byte what finalizePlan produces for its content.
    return plan as ValidatedPlan
  })

export const parsePlan = (text: string): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Effect.gen(function* () {
    const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(text).pipe(
      Effect.mapError(() => new PlanDecodeError({ detail: "Plan is not valid JSON" })),
    )
    // SAFETY: validatePlan decodes its argument before trusting it.
    const plan = yield* validatePlan(json as TransformationPlan)
    if (text !== serializePlan(plan)) {
      return yield* new PlanDecodeError({ detail: "Plan text is not canonical JSON" })
    }
    return plan
  })
