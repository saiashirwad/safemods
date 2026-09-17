import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import {
  finalizePlan,
  parsePlan,
  planIdOf,
  serializePlan,
  type TransformationPlan,
  validatePlan,
} from "../src/Plan.ts"
import { richInput, semanticMutations } from "./utils/plan-schema.ts"
import type * as ProjectRelativePath from "../src/ProjectRelativePath.ts"
import * as Sha256 from "../src/Sha256.ts"

const uncheckedPath = (value: string) => value as ProjectRelativePath.Type
const uncheckedHash = (value: string) => value as Sha256.Type

const rejects = (plan: TransformationPlan) =>
  Effect.gen(function* () {
    const validated = yield* validatePlan(plan).pipe(Effect.result)
    const parsed = yield* parsePlan(serializePlan(plan)).pipe(Effect.result)
    return validated._tag === "Failure" && parsed._tag === "Failure"
  })

describe("plan validation", () => {
  effect("accepts disjoint edits, creation, deletion, and movement in one plan", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan({
        ...richInput,
        edits: [
          ...richInput.edits,
          { ...richInput.edits[0]!, start: 2, end: 3, expectedTextHash: Sha256.digest("u") },
        ],
      })
      expect(plan.edits).toHaveLength(2)
      expect(plan.fileOperations.map((operation) => operation.kind)).toEqual([
        "create",
        "delete",
        "move",
      ])
    }),
  )

  effect("treats the same relative path in different projects as different sources", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan({
        ...richInput,
        projects: [...richInput.projects, { id: "other", configFileName: "other/tsconfig.json" }],
        sources: [
          ...richInput.sources,
          { projectId: "other", fileName: "src/index.ts", kind: "missing" },
        ],
        fileOperations: [
          ...richInput.fileOperations,
          {
            kind: "create",
            projectId: "other",
            fileName: "src/index.ts",
            content: "",
          },
        ],
      })
      expect(plan.projects).toHaveLength(2)
    }),
  )

  effect("accepts edits to a file that the same plan moves", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan({
        ...richInput,
        edits: [...richInput.edits, { ...richInput.edits[0]!, fileName: "src/move.ts" }],
      })
      expect(plan.edits.map((edit) => edit.fileName)).toEqual(["src/index.ts", "src/move.ts"])
    }),
  )

  effect("rejects semantic input mutations", () =>
    Effect.gen(function* () {
      for (const mutation of semanticMutations) {
        const result = yield* finalizePlan(mutation.mutate(richInput)).pipe(Effect.result)
        expect({ name: mutation.name, outcome: result._tag }).toEqual({
          name: mutation.name,
          outcome: "Failure",
        })
      }
    }),
  )

  effect("rejects unknown and missing fields", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const { recipe: _, ...missingRecipe } = plan
      expect(yield* rejects({ ...plan, unexpected: true } as TransformationPlan)).toBe(true)
      expect(yield* rejects(missingRecipe as TransformationPlan)).toBe(true)
    }),
  )

  effect("rejects tampered hashes and non-canonical ordering", () =>
    Effect.gen(function* () {
      const plan = yield* finalizePlan(richInput)
      const rehash = ({ planId: _, ...content }: TransformationPlan): TransformationPlan => ({
        ...content,
        planId: planIdOf(content),
      })
      const tampered: ReadonlyArray<TransformationPlan> = [
        { ...plan, planId: uncheckedHash("0".repeat(64)) },
        rehash({ ...plan, fileOperations: [...plan.fileOperations].reverse() }),
        rehash({ ...plan, sources: [...plan.sources].reverse() }),
        rehash({
          ...plan,
          edits: [{ ...plan.edits[0]!, fileName: uncheckedPath("./src/index.ts") }],
        }),
      ]
      for (const candidate of tampered) expect(yield* rejects(candidate)).toBe(true)
    }),
  )
})
