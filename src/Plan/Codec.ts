import { Effect, Schema } from "effect"
import { sha256 } from "../Edit/Hash.ts"
import { compareEdits } from "../Edit/index.ts"
import { canonicalJson } from "../Evidence/Canonical.ts"
import type { Json } from "../Evidence/Evidence.ts"
import { PlanDecodeError, type PlanInput, type TransformationPlan } from "./TransformationPlan.ts"
import { strictPlanParseOptions, TransformationPlanSchema } from "./Structure.ts"
import {
  compareFileOperations,
  compareIds,
  compareSourceFingerprints,
  normalizedPath,
  validateDecodedPlan,
} from "./Validate.ts"

declare const ValidatedPlanTypeId: unique symbol
export type ValidatedPlan = TransformationPlan & {
  readonly [ValidatedPlanTypeId]: true
}

export { canonicalJson, compareSourceFingerprints }

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

const validateSnapshotHash = (plan: TransformationPlan): Effect.Effect<void, PlanDecodeError> => {
  const { schemaVersion: _, planId: __, snapshotHash: ___, ...content } = plan
  return snapshotHashOf(content) === plan.snapshotHash
    ? Effect.void
    : Effect.fail(new PlanDecodeError({ reason: "schema" }))
}

const validateContentAddressedPlan = (
  plan: TransformationPlan,
): Effect.Effect<ValidatedPlan, PlanDecodeError> =>
  Effect.gen(function* () {
    yield* validateDecodedPlan(plan).pipe(
      Effect.mapError(() => new PlanDecodeError({ reason: "schema" })),
    )
    yield* validateSnapshotHash(plan)
    if (planHashOf(plan) !== plan.planId) {
      return yield* new PlanDecodeError({ reason: "hash" })
    }
    // SAFETY: every structural, semantic, canonical, snapshot-hash, and plan-hash check passed.
    return plan as ValidatedPlan
  })

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
