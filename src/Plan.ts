import { Data, Effect, Order, Predicate, Schema } from "effect"
import { compareEdits, firstConflict, NonNegativeInt, TextEdit } from "./Edit.ts"
import * as FileRef from "./FileRef.ts"
import * as ProjectId from "./ProjectId.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Sha256 from "./Sha256.ts"

export type { TextEdit } from "./Edit.ts"

const fileRef = { projectId: ProjectId.schema, fileName: ProjectRelativePath.schema }

export const SourceFingerprint = Schema.Union([
  Schema.Struct({ ...fileRef, kind: Schema.Literal("file"), hash: Sha256.schema }),
  Schema.Struct({ ...fileRef, kind: Schema.Literal("missing") }),
])
export type SourceFingerprint = typeof SourceFingerprint.Type

export const FileOperation = Schema.Union([
  Schema.Struct({
    ...fileRef,
    kind: Schema.Literal("create"),
    content: Schema.String,
  }),
  Schema.Struct({
    ...fileRef,
    kind: Schema.Literal("delete"),
  }),
  Schema.Struct({
    ...fileRef,
    kind: Schema.Literal("move"),
    toFileName: ProjectRelativePath.schema,
  }),
])
export type FileOperation = typeof FileOperation.Type

export const PlanPolicies = Schema.Struct({
  maxAffectedFiles: Schema.optionalKey(NonNegativeInt),
  diagnostics: Schema.Literals(["no-new-errors", "allow-new-errors"]),
  idempotence: Schema.Literals(["required", "not-promised"]),
})
export type PlanPolicies = typeof PlanPolicies.Type

const contentFields = {
  recipe: Schema.Struct({ name: Schema.String, version: Schema.String, options: Schema.Json }),
  projects: Schema.Array(
    Schema.Struct({ id: ProjectId.schema, configFileName: ProjectRelativePath.schema }),
  ),
  sources: Schema.Array(SourceFingerprint),
  edits: Schema.Array(TextEdit),
  fileOperations: Schema.Array(FileOperation),
  policies: PlanPolicies,
}

export const PlanInput = Schema.Struct(contentFields)
export type PlanInput = typeof PlanInput.Encoded
type PlanContent = typeof PlanInput.Type

const UnsignedPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ...contentFields,
})
type UnsignedPlan = typeof UnsignedPlan.Type

type EncodedUnsignedPlan = typeof UnsignedPlan.Encoded

export const TransformationPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: Sha256.schema,
  ...contentFields,
})
export type TransformationPlan = typeof TransformationPlan.Type
export type EncodedTransformationPlan = typeof TransformationPlan.Encoded

declare const ValidatedPlanTypeId: unique symbol
export type ValidatedPlan = TransformationPlan & { readonly [ValidatedPlanTypeId]: true }

export class InvalidPlan extends Data.TaggedError("InvalidPlan")<{
  readonly phase: "build" | "decode"
  readonly detail: string
}> {}

const canonicalReplacer = (_: string, nested: Schema.Json): Schema.Json => {
  if (!Predicate.isObject(nested)) return nested
  const sorted: Record<string, Schema.Json> = {}
  for (const key of Object.keys(nested).sort(Order.String)) {
    const value = nested[key]
    if (value !== undefined) sorted[key] = value as Schema.Json
  }
  return sorted
}

export const canonicalJson = (value: Schema.Json): string =>
  JSON.stringify(value, canonicalReplacer)

const strict = { onExcessProperty: "error" } as const
const PlanJson = Schema.fromJsonString(TransformationPlan, { replacer: canonicalReplacer })

const encodePlan = Schema.encodeSync(TransformationPlan, strict)
export const serializePlan = (plan: TransformationPlan): string => canonicalJson(encodePlan(plan))

const encodeUnsignedPlan = Schema.encodeSync(UnsignedPlan, strict)

export const planIdOf = (plan: UnsignedPlan): Sha256.Type =>
  Sha256.digest(canonicalJson(encodeUnsignedPlan(plan)))

const byFile = Order.Struct({ projectId: Order.String, fileName: Order.String })
const byProject = Order.Struct({ id: Order.String, configFileName: Order.String })
const bySource = Order.combine(
  byFile,
  Order.make((left: SourceFingerprint, right: SourceFingerprint) =>
    Order.String(canonicalJson(left), canonicalJson(right)),
  ),
)
const byOperation = Order.combine(
  byFile,
  Order.make((left: FileOperation, right: FileOperation) =>
    Order.String(canonicalJson(left), canonicalJson(right)),
  ),
)
const byEdit = Order.make((left: TextEdit, right: TextEdit) => {
  const compared = compareEdits(left, right)
  return compared < 0
    ? -1
    : compared > 0
      ? 1
      : Order.String(left.expectedTextHash, right.expectedTextHash)
})

const canonicalize = (input: PlanContent): PlanContent => ({
  ...input,
  projects: [...input.projects].sort(byProject),
  sources: [...input.sources].sort(bySource),
  edits: [...input.edits].sort(byEdit),
  fileOperations: [...input.fileOperations].sort(byOperation),
})

const encodedUnsignedPlan = ({
  planId: _,
  ...unsigned
}: EncodedTransformationPlan): EncodedUnsignedPlan => unsigned

const duplicate = (values: ReadonlyArray<string>): string | undefined => {
  const seen = new Set<string>()
  return values.find((value) => seen.size === seen.add(value).size)
}

const semanticError = (plan: PlanContent): string | undefined => {
  if (plan.projects.length === 0) return "A plan must contain at least one project"
  const repeatedProject =
    duplicate(plan.projects.map((project) => project.id)) ??
    duplicate(plan.projects.map((project) => project.configFileName))
  if (repeatedProject !== undefined) return `Duplicate project ${repeatedProject}`

  const projectIds = new Set<string>(plan.projects.map((project) => project.id))
  const sources = new Map<string, SourceFingerprint>()
  for (const source of plan.sources) {
    if (!projectIds.has(source.projectId)) return `Unknown project ${source.projectId}`
    if (sources.has(FileRef.key(source))) return `Duplicate source ${source.fileName}`
    sources.set(FileRef.key(source), source)
  }

  if (firstConflict(plan.edits) !== undefined) return "Overlapping edits"
  const edited = new Set<string>()
  for (const edit of plan.edits) {
    if (sources.get(FileRef.key(edit))?.kind !== "file") return `Missing source ${edit.fileName}`
    edited.add(FileRef.key(edit))
  }

  const roots = new Map<string, string>(
    plan.projects.map(({ id, configFileName }) => [
      id,
      configFileName.split("/").slice(0, -1).join("/"),
    ]),
  )
  const owners = new Map<string, string>()
  const moveTargets = plan.fileOperations.flatMap((operation) =>
    operation.kind === "move"
      ? [{ projectId: operation.projectId, fileName: operation.toFileName }]
      : [],
  )
  for (const { projectId, fileName } of [...plan.edits, ...plan.fileOperations, ...moveTargets]) {
    const diskPath = `${roots.get(projectId)}/${fileName}`
    const owner = owners.get(diskPath) ?? projectId
    if (owner !== projectId) return `${fileName} is changed through both ${owner} and ${projectId}`
    owners.set(diskPath, owner)
  }

  const operated = new Set<string>()
  for (const operation of plan.fileOperations) {
    const from = FileRef.key(operation)
    const source = sources.get(from)
    const touched = [from]
    if (operation.kind === "create") {
      if (source?.kind !== "missing") return `Create needs an absent path: ${operation.fileName}`
    } else {
      if (source?.kind !== "file") return `Missing source ${operation.fileName}`
    }
    if (operation.kind === "move") {
      const to = FileRef.key({ projectId: operation.projectId, fileName: operation.toFileName })
      if (sources.get(to)?.kind !== "missing") {
        return `Move needs an absent target: ${operation.toFileName}`
      }
      touched.push(to)
    } else if (edited.has(from)) {
      return `Edit conflicts with ${operation.kind} of ${operation.fileName}`
    }
    for (const key of touched) {
      if (operated.has(key)) return `Conflicting file operations on ${operation.fileName}`
      operated.add(key)
    }
  }
  return undefined
}

export const finalizePlan = (input: PlanInput): Effect.Effect<TransformationPlan, InvalidPlan> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeEffect(
      PlanInput,
      strict,
    )(input).pipe(
      Effect.mapError(() => new InvalidPlan({ phase: "build", detail: "Plan shape is invalid" })),
    )
    const content = canonicalize(decoded)
    const detail = semanticError(content)
    if (detail !== undefined) return yield* new InvalidPlan({ phase: "build", detail })
    const unsigned = { schemaVersion: 1 as const, ...content }
    return { ...unsigned, planId: planIdOf(unsigned) }
  })

export const validatePlan = (plan: TransformationPlan): Effect.Effect<ValidatedPlan, InvalidPlan> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeEffect(
      TransformationPlan,
      strict,
    )(plan).pipe(
      Effect.mapError(() => new InvalidPlan({ phase: "decode", detail: "Plan shape is invalid" })),
    )
    const { schemaVersion: _, planId: __, ...content } = decoded
    const rebuilt = yield* finalizePlan(content).pipe(
      Effect.mapError((error) => new InvalidPlan({ phase: "decode", detail: error.detail })),
    )
    const encoded = encodePlan(decoded)
    if (
      canonicalJson(plan) !== canonicalJson(encoded) ||
      serializePlan(decoded) !== serializePlan(rebuilt) ||
      decoded.planId !== Sha256.digest(canonicalJson(encodedUnsignedPlan(encoded)))
    ) {
      return yield* new InvalidPlan({
        phase: "decode",
        detail: "Plan is not canonical or its hash is wrong",
      })
    }
    return rebuilt as ValidatedPlan
  })

export const parsePlan = (text: string): Effect.Effect<ValidatedPlan, InvalidPlan> =>
  Effect.gen(function* () {
    const plan = yield* Schema.decodeEffect(
      PlanJson,
      strict,
    )(text).pipe(
      Effect.mapError(() => new InvalidPlan({ phase: "decode", detail: "Plan is not valid JSON" })),
    )
    const validated = yield* validatePlan(plan)
    if (text !== serializePlan(validated)) {
      return yield* new InvalidPlan({ phase: "decode", detail: "Plan text is not canonical JSON" })
    }
    return validated
  })
