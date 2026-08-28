/** Strict canonicalization, serialization, and decoding for content-addressed plans. */
import { Effect, Schema } from "effect"
import { compareEdits, sha256 } from "../Edit/index.ts"
import { canonicalJson } from "../Evidence/Canonical.ts"
import type { Json } from "../Evidence/Evidence.ts"
import {
  PlanDecodeError,
  type PlanInput,
  type PlannedFileOperation,
  type SourceFingerprint,
  type TransformationPlan,
} from "./TransformationPlan.ts"
import { strictPlanParseOptions, TransformationPlanSchema } from "./Structure.ts"
import { normalizedPath, validateDecodedPlan } from "./Validate.ts"

declare const ValidatedPlanTypeId: unique symbol
export type ValidatedPlan = TransformationPlan & {
  readonly [ValidatedPlanTypeId]: true
}

export { canonicalJson }

const asEncodedJson = (
  value:
    | Json
    | TransformationPlan
    | {
        readonly projects: TransformationPlan["projects"]
        readonly sources: TransformationPlan["sources"]
      },
): Json =>
  // SAFETY: plan schemas contain only JSON values.
  value as Json

const compareIds = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id.localeCompare(right.id)

export const compareSourceFingerprints = (
  left: SourceFingerprint,
  right: SourceFingerprint,
): number =>
  left.projectId.localeCompare(right.projectId) ||
  left.fileName.localeCompare(right.fileName) ||
  (left.kind ?? "file").localeCompare(right.kind ?? "file")

const compareFileOperations = (left: PlannedFileOperation, right: PlannedFileOperation): number =>
  left.projectId.localeCompare(right.projectId) ||
  left.path.localeCompare(right.path) ||
  left.kind.localeCompare(right.kind)

/** Normalize and order every field that contributes to a plan's durable content. */
export const canonicalizeContent = (input: PlanInput): PlanInput => {
  const projects = input.projects
    .map((project) => ({
      ...project,
      configFileName: normalizedPath(project.configFileName)!,
    }))
    .sort(compareIds)
  const sources = input.sources
    .map((source) => ({
      ...source,
      fileName: normalizedPath(source.fileName)!,
    }))
    .sort(compareSourceFingerprints)
  const edits = input.edits
    .map((edit) => ({
      ...edit,
      fileName: normalizedPath(edit.fileName)!,
      evidenceIds: [...edit.evidenceIds].sort(),
    }))
    .sort(compareEdits)
  const evidence = [...input.evidence].sort(compareIds)
  const fileOperations = input.fileOperations
    ?.map((operation) =>
      operation.kind === "move"
        ? {
            ...operation,
            path: normalizedPath(operation.path)!,
            toPath: normalizedPath(operation.toPath)!,
            evidenceIds:
              operation.evidenceIds === undefined ? undefined : [...operation.evidenceIds].sort(),
          }
        : {
            ...operation,
            path: normalizedPath(operation.path)!,
            evidenceIds:
              operation.evidenceIds === undefined ? undefined : [...operation.evidenceIds].sort(),
          },
    )
    .sort(compareFileOperations)
  const content = { ...input, projects, sources, edits, evidence }
  return fileOperations === undefined ? content : { ...content, fileOperations }
}

export const snapshotHashOf = ({
  projects,
  sources,
}: Pick<PlanInput, "projects" | "sources">): string =>
  sha256(canonicalJson(asEncodedJson({ projects, sources })))

export const planHashOf = (plan: TransformationPlan): string => {
  const { planId: _, ...content } = plan
  return sha256(canonicalJson(asEncodedJson(content)))
}

export const serializePlan = (plan: TransformationPlan): string =>
  canonicalJson(asEncodedJson(plan))

const decodeTransformationPlan = Schema.decodeUnknownEffect(
  TransformationPlanSchema,
  strictPlanParseOptions,
)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- parse/validate I/O boundary; Schema is the parser.
const decodePlan = (decoded: unknown): Effect.Effect<TransformationPlan, PlanDecodeError> =>
  decodeTransformationPlan(decoded).pipe(
    Effect.mapError(() => new PlanDecodeError({ reason: "schema" })),
    Effect.map(
      // SAFETY: the schema validates every field; branded path types are runtime strings.
      (value) => value as TransformationPlan,
    ),
  )

const validateCanonicalContent = (
  plan: TransformationPlan,
): Effect.Effect<void, PlanDecodeError> => {
  const { schemaVersion: _, planId: __, snapshotHash: ___, ...content } = plan
  if (JSON.stringify(content) !== JSON.stringify(canonicalizeContent(content))) {
    return Effect.fail(new PlanDecodeError({ reason: "schema" }))
  }
  if (snapshotHashOf(content) !== plan.snapshotHash) {
    return Effect.fail(new PlanDecodeError({ reason: "schema" }))
  }
  return Effect.void
}

const validateContentAddressedPlan = (
  plan: TransformationPlan,
): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Effect.gen(function* () {
    yield* validateDecodedPlan(plan).pipe(
      Effect.mapError(() => new PlanDecodeError({ reason: "schema" })),
    )
    yield* validateCanonicalContent(plan)
    if (planHashOf(plan) !== plan.planId) {
      return yield* new PlanDecodeError({ reason: "hash" })
    }
    // SAFETY: every structural, semantic, canonical, snapshot-hash, and plan-hash check passed.
    return plan as ValidatedPlan
  })

/** Reject a plan that is not structurally exact, canonical, and content-addressed. */
export const validatePlan = (
  plan: TransformationPlan,
): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Effect.gen(function* () {
    yield* decodePlan(plan)
    return yield* validateContentAddressedPlan(plan)
  })

export const parsePlan = (text: string): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(text).pipe(
    Effect.mapError(() => new PlanDecodeError({ reason: "json" })),
    Effect.flatMap(decodePlan),
    Effect.flatMap((plan) =>
      Effect.gen(function* () {
        if (text !== canonicalJson(asEncodedJson(plan)))
          return yield* new PlanDecodeError({ reason: "schema" })
        return yield* validateContentAddressedPlan(plan)
      }),
    ),
  )
