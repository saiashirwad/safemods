import { Data, Schema } from "effect"
import { NonNegativeInt, TextEdit } from "../Edit.ts"
import { EvidenceRecord } from "../Evidence.ts"

const EvidenceIds = Schema.optional(Schema.Array(Schema.String))

export const SourceFingerprint = Schema.Struct({
  projectId: Schema.String,
  fileName: Schema.String,
  hash: Schema.String,
  kind: Schema.optional(Schema.Literals(["file", "missing"])),
})
export type SourceFingerprint = typeof SourceFingerprint.Type

export const isContentFingerprint = (source: SourceFingerprint): boolean =>
  source.kind === undefined || source.kind === "file"

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
  fileOperations: Schema.optional(Schema.Array(PlannedFileOperation)),
  evidence: Schema.Array(EvidenceRecord),
  policies: PlanPolicies,
  measurements: Schema.optional(Schema.Struct({ matches: Schema.optional(NonNegativeInt) })),
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

export const strictPlanParseOptions = { onExcessProperty: "error" } as const

export class PlanBuildError extends Data.TaggedError("PlanBuildError")<{
  readonly reason:
    | "invalid-edit"
    | "edit-conflict"
    | "missing-source"
    | "duplicate-evidence"
    | "invalid-path"
    | "invalid-file-operation"
    | "duplicate-project"
    | "duplicate-source"
    | "missing-evidence"
    | "invalid-policy"
    | "invalid-plan"
  readonly detail: string
}> {}

export class PlanDecodeError extends Data.TaggedError("PlanDecodeError")<{
  readonly reason: "json" | "schema" | "hash"
}> {}
