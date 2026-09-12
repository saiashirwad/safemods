/**
 * The durable, content-addressed plan artifact.
 *
 * finalizePlan(input)  = decode → canonicalize → check semantics → stamp hashes
 * validatePlan(plan)   = decode → finalizePlan(content) → must reproduce the plan exactly
 * parsePlan(text)      = JSON → validatePlan → text must be the canonical serialization
 */
import { Data, Effect, Order, Schema } from "effect"
import { compareEdits, editsConflict, NonNegativeInt, TextEdit } from "./Edit.ts"
import { canonicalJson, EvidenceRecord } from "./Evidence.ts"
import * as ProjectId from "./ProjectId.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Sha256 from "./Sha256.ts"
import { virtualFileKey } from "./VirtualFs.ts"

export type { TextEdit } from "./Edit.ts"
export type { EvidenceRecord } from "./Evidence.ts"

// ---------------------------------------------------------------------------
// Schema

export const SourceFingerprint = Schema.Union([
  Schema.Struct({
    projectId: ProjectId.schema,
    fileName: ProjectRelativePath.schema,
    hash: Sha256.schema,
    kind: Schema.Literal("file"),
  }),
  Schema.Struct({
    projectId: ProjectId.schema,
    fileName: ProjectRelativePath.schema,
    kind: Schema.Literal("missing"),
  }),
])
export type SourceFingerprint = typeof SourceFingerprint.Type

const EvidenceIds = Schema.Array(Schema.String)

export const PlannedFileOperation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    projectId: ProjectId.schema,
    path: ProjectRelativePath.schema,
    content: Schema.String,
    evidenceIds: EvidenceIds,
  }),
  Schema.Struct({
    kind: Schema.Literal("delete"),
    projectId: ProjectId.schema,
    path: ProjectRelativePath.schema,
    initialHash: Sha256.schema,
    evidenceIds: EvidenceIds,
  }),
  Schema.Struct({
    kind: Schema.Literal("move"),
    projectId: ProjectId.schema,
    path: ProjectRelativePath.schema,
    toPath: ProjectRelativePath.schema,
    content: Schema.optional(Schema.String),
    initialHash: Sha256.schema,
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
    options: Schema.Json,
  }),
  toolchain: Schema.Struct({
    systemVersion: Schema.String,
    typescriptVersion: Schema.String,
    effectVersion: Schema.String,
  }),
  projects: Schema.Array(
    Schema.Struct({ id: ProjectId.schema, configFileName: ProjectRelativePath.schema }),
  ),
  sources: Schema.Array(SourceFingerprint),
  edits: Schema.Array(TextEdit),
  fileOperations: Schema.Array(PlannedFileOperation),
  evidence: Schema.Array(EvidenceRecord),
  policies: PlanPolicies,
  measurements: Schema.Struct({ matches: NonNegativeInt }),
}

export const PlanInput = Schema.Struct(planContentFields)
export type PlanInput = typeof PlanInput.Encoded
type DecodedPlanInput = typeof PlanInput.Type

export const TransformationPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: Sha256.schema,
  ...planContentFields,
  snapshotHash: Sha256.schema,
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
  value: DecodedPlanInput | TransformationPlan | Pick<DecodedPlanInput, "projects" | "sources">,
): string =>
  // SAFETY: plan schemas contain only JSON values.
  canonicalJson(value as Schema.Json)

export const serializePlan = (plan: TransformationPlan): string => canonical(plan)

export const snapshotHashOf = ({
  projects,
  sources,
}: Pick<DecodedPlanInput, "projects" | "sources">): Sha256.Type =>
  Sha256.digest(canonical({ projects, sources }))

export const planHashOf = (plan: TransformationPlan): Sha256.Type => {
  const { planId: _, ...content } = plan
  return Sha256.digest(canonical(content))
}

/** Sort every collection into the durable plan order. */
const canonicalize = (input: DecodedPlanInput): DecodedPlanInput => ({
  ...input,
  projects: [...input.projects].sort(Order.Struct({ id: Order.String })),
  sources: [...input.sources].sort(
    Order.Struct({ projectId: Order.String, fileName: Order.String, kind: Order.String }),
  ),
  edits: input.edits
    .map((edit) => ({
      ...edit,
      evidenceIds: [...edit.evidenceIds].sort(Order.String),
    }))
    .sort(compareEdits),
  evidence: [...input.evidence].sort(Order.Struct({ id: Order.String })),
  fileOperations: input.fileOperations
    .map((operation) => ({
      ...operation,
      evidenceIds: [...operation.evidenceIds].sort(Order.String),
    }))
    .sort(Order.Struct({ projectId: Order.String, path: Order.String, kind: Order.String })),
})

// ---------------------------------------------------------------------------
// Semantic checks (run on canonical input)

const checkSemantics = (input: DecodedPlanInput): PlanBuildError | undefined => {
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
      if (source.kind !== "file" || operation.initialHash !== source.hash) {
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
    const decoded = yield* Schema.decodeEffect(
      PlanInput,
      strict,
    )(input).pipe(Effect.mapError(() => new PlanBuildError({ detail: "Plan shape is invalid" })))
    const content = canonicalize(decoded)
    const error = checkSemantics(content)
    if (error !== undefined) return yield* error
    const provisional = {
      schemaVersion: 1 as const,
      ...content,
      snapshotHash: snapshotHashOf(content),
    }
    return { ...provisional, planId: Sha256.digest(canonical(provisional)) }
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
