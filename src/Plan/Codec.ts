import { hash } from "node:crypto"
import { Effect, Schema } from "effect"
import { canonicalJson } from "../Evidence.ts"
import {
  PlanDecodeError,
  type PlanInput,
  strictPlanParseOptions,
  TransformationPlan,
} from "./TransformationPlan.ts"
import { validateDecodedPlan } from "./Validate.ts"

declare const ValidatedPlanTypeId: unique symbol
export type ValidatedPlan = TransformationPlan & {
  readonly [ValidatedPlanTypeId]: true
}

const asEncodedJson = (
  value:
    | Schema.Json
    | TransformationPlan
    | {
        readonly projects: TransformationPlan["projects"]
        readonly sources: TransformationPlan["sources"]
      },
): Schema.Json =>
  // SAFETY: plan schemas contain only JSON values.
  value as Schema.Json

export const snapshotHashOf = ({
  projects,
  sources,
}: Pick<PlanInput, "projects" | "sources">): string =>
  hash("sha256", canonicalJson(asEncodedJson({ projects, sources })), "hex")

export const planHashOf = (plan: TransformationPlan): string => {
  const { planId: _, ...content } = plan
  return hash("sha256", canonicalJson(asEncodedJson(content)), "hex")
}

export const serializePlan = (plan: TransformationPlan): string =>
  canonicalJson(asEncodedJson(plan))

const decodeTransformationPlan = Schema.decodeUnknownEffect(
  TransformationPlan,
  strictPlanParseOptions,
)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- parse/validate I/O boundary; Schema is the parser.
const decodePlan = (decoded: unknown): Effect.Effect<TransformationPlan, PlanDecodeError> =>
  decodeTransformationPlan(decoded).pipe(
    Effect.mapError(() => new PlanDecodeError({ reason: "schema" })),
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
