import { Data, Effect, type JsonSchema, Predicate, Schema, SchemaIssue } from "effect"
import type { Json } from "../Evidence/index.ts"
import { executeRecipe } from "../Execution/index.ts"
import { layer as nodeLayer } from "../Node/index.ts"
import type { DiagnosticDiff, DiagnosticRecord } from "../Policy/index.ts"
import { type Recipe as RecipeModel, RecipeInputError } from "../Recipe/index.ts"
import { StalePlanError, VerificationFailure, type PolicyResult } from "../Verification/index.ts"
import type { Workspace, WorkspaceSnapshot } from "../Workspace/index.ts"

export type ToolAction = "create" | "delete" | "modify" | "move"

export interface ToolFileResult {
  readonly fileName: string
  readonly action: ToolAction
}

export interface ToolSchemaIssue {
  readonly path: ReadonlyArray<string | number>
  readonly code: string
  readonly message: string
}

export type ToolExecutionErrorDetails =
  | {
      readonly _tag: "VerificationFailure"
      readonly policy: VerificationFailure["policy"]
      readonly detail: string
      readonly diagnostics: ReadonlyArray<DiagnosticRecord>
    }
  | {
      readonly _tag: "StalePlanError"
      readonly planId: string
      readonly projectId: string
      readonly fileName: string
    }
  | {
      readonly _tag: "SchemaError"
      readonly issues: ReadonlyArray<ToolSchemaIssue>
    }
  | {
      readonly _tag: "UnknownToolError"
      readonly message: string
    }

export interface AgentToolResult {
  readonly planId: string
  readonly status: "preview" | "applied"
  readonly affectedFiles: number
  readonly diagnosticDelta: number
  readonly idempotenceChecked: boolean
  readonly files: ReadonlyArray<ToolFileResult>
  readonly diagnostics: DiagnosticDiff
  readonly policyResults: ReadonlyArray<PolicyResult>
}

export type AgentToolInputSchema = Exclude<Extract<Json, object>, ReadonlyArray<Json>> & {
  readonly type: "object"
  readonly properties: Exclude<Extract<Json, object>, ReadonlyArray<Json>>
}

export interface AgentTool<R = never> {
  readonly name: string
  readonly description: string
  readonly schema: AgentToolInputSchema
  readonly execute: (
    input: Json,
    options?: { readonly apply?: boolean },
  ) => Effect.Effect<AgentToolResult, ToolExecutionError, Workspace | R>
}

export class ToolExecutionError extends Data.TaggedError("ToolExecutionError")<{
  readonly recipe: string
  readonly cause: unknown
  readonly details: ToolExecutionErrorDetails
}> {}

const emptyObjectSchema: AgentToolInputSchema = { type: "object", properties: {} }

const isJson = Schema.is(Schema.Json)
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON protocol boundary; Schema.Json performs the runtime parse.
const isJsonObject = (value: unknown): value is AgentToolInputSchema["properties"] =>
  isJson(value) && Predicate.isObject(value)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON protocol boundary delegated to isJsonObject.
const asJsonObject = (value: unknown): AgentToolInputSchema["properties"] | undefined =>
  isJsonObject(value) ? value : undefined
const protocolInputSchema = (
  generated: JsonSchema.Document<"draft-2020-12">,
): AgentToolInputSchema => {
  const schemaObject = asJsonObject(generated.schema)
  const schema: Record<string, Json> = {}
  if (schemaObject !== undefined) Object.assign(schema, schemaObject)
  const definitions = asJsonObject(generated.definitions)
  if (
    definitions !== undefined &&
    Object.keys(definitions).length > 0 &&
    schema.$defs === undefined
  ) {
    schema.$defs = definitions
  }
  return {
    ...schema,
    type: "object",
    properties: asJsonObject(schema.properties) ?? {},
  }
}
export const recipeToAgentTool = <Input = undefined, E = never, R = never>(
  recipe: RecipeModel<Input, E, R>,
  description = `Transform codebase using ${recipe.name}`,
): AgentTool<Exclude<R, WorkspaceSnapshot>> => {
  let jsonSchema: AgentToolInputSchema = emptyObjectSchema
  if (recipe.schema !== undefined) {
    jsonSchema = protocolInputSchema(Schema.toJsonSchemaDocument(recipe.schema))
  }

  return {
    name: `safemods_${recipe.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
    description,
    schema: jsonSchema,
    execute: (rawInput, options = {}) =>
      Effect.gen(function* () {
        // SAFETY: Recipe.run validates raw tool input against the recipe schema.
        const typedInput = rawInput as Input
        const mode = options.apply === true ? "apply" : "verify"
        const execution = yield* executeRecipe(recipe, typedInput, { mode }).pipe(
          Effect.provide(nodeLayer),
          Effect.mapError((cause) => makeToolExecutionError(recipe.name, cause)),
        )

        const files: ReadonlyArray<ToolFileResult> = execution.preview.files.map((file) => ({
          fileName: file.fileName,
          action: file.action,
        }))

        return {
          planId: execution.plan.planId,
          status: mode === "apply" ? ("applied" as const) : ("preview" as const),
          affectedFiles: execution.preview.files.length,
          diagnosticDelta: execution.verified.receipt.diagnosticDelta,
          idempotenceChecked: execution.verified.receipt.idempotenceChecked,
          files,
          diagnostics: execution.verified.diagnosticDiff,
          policyResults: execution.verified.receipt.policyResults,
        }
      }),
  }
}

const schemaIssueFormatter = SchemaIssue.makeFormatterDefault()

const flattenSchemaIssue = (
  issue: SchemaIssue.Issue,
  prefix: ReadonlyArray<string | number> = [],
): ReadonlyArray<ToolSchemaIssue> => {
  switch (issue._tag) {
    case "Pointer":
      return flattenSchemaIssue(
        issue.issue,
        prefix.concat(
          issue.path.map((segment) => (Predicate.isNumber(segment) ? segment : String(segment))),
        ),
      )
    case "Composite":
      return issue.issues.flatMap((child) => flattenSchemaIssue(child, prefix))
    case "Filter":
    case "Encoding":
      return flattenSchemaIssue(issue.issue, prefix)
    case "AnyOf":
    case "Forbidden":
    case "InvalidType":
    case "InvalidValue":
    case "MissingKey":
    case "OneOf":
    case "UnexpectedKey":
      return [
        {
          path: prefix,
          code: issue._tag,
          message: schemaIssueFormatter(issue),
        },
      ]
  }
}

const schemaDetails = (cause: Schema.SchemaError): ToolExecutionErrorDetails => ({
  _tag: "SchemaError",
  issues: flattenSchemaIssue(cause.issue),
})

const detailsForCause = (cause: unknown): ToolExecutionErrorDetails => {
  if (cause instanceof VerificationFailure) {
    return {
      _tag: "VerificationFailure",
      policy: cause.policy,
      detail: cause.detail,
      diagnostics: cause.diagnostics ?? [],
    }
  }
  if (cause instanceof StalePlanError) {
    return {
      _tag: "StalePlanError",
      planId: cause.planId,
      projectId: cause.projectId,
      fileName: cause.fileName,
    }
  }
  if (Schema.isSchemaError(cause)) return schemaDetails(cause)
  if (cause instanceof RecipeInputError && Schema.isSchemaError(cause.cause)) {
    return schemaDetails(cause.cause)
  }
  if (Predicate.isObject(cause) && "cause" in cause && Schema.isSchemaError(cause.cause)) {
    return schemaDetails(cause.cause)
  }
  return { _tag: "UnknownToolError", message: String(cause) }
}

const makeToolExecutionError = (recipe: string, cause: unknown): ToolExecutionError =>
  new ToolExecutionError({ recipe, cause, details: detailsForCause(cause) })
