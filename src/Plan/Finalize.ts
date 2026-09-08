import { Effect } from "effect"
import { compareEdits } from "../Edit.ts"
import { parseProjectRelativePath } from "../ProjectPath.ts"
import { planHashOf, snapshotHashOf } from "./Codec.ts"
import type { PlanBuildError, PlanInput, TransformationPlan } from "./TransformationPlan.ts"
import {
  compareFileOperations,
  compareIds,
  compareSourceFingerprints,
  validateInput,
} from "./Validate.ts"

const canonicalizeContent = (input: PlanInput): PlanInput => {
  const projects = input.projects
    .map((project) => ({
      ...project,
      configFileName: parseProjectRelativePath(project.configFileName)!,
    }))
    .sort(compareIds)
  const sources = input.sources
    .map((source) => ({
      ...source,
      fileName: parseProjectRelativePath(source.fileName)!,
    }))
    .sort(compareSourceFingerprints)
  const edits = input.edits
    .map((edit) => ({
      ...edit,
      fileName: parseProjectRelativePath(edit.fileName)!,
      evidenceIds: [...edit.evidenceIds].sort(),
    }))
    .sort(compareEdits)
  const evidence = [...input.evidence].sort(compareIds)
  const fileOperations = input.fileOperations
    ?.map((operation) =>
      operation.kind === "move"
        ? {
            ...operation,
            path: parseProjectRelativePath(operation.path)!,
            toPath: parseProjectRelativePath(operation.toPath)!,
            evidenceIds:
              operation.evidenceIds === undefined ? undefined : [...operation.evidenceIds].sort(),
          }
        : {
            ...operation,
            path: parseProjectRelativePath(operation.path)!,
            evidenceIds:
              operation.evidenceIds === undefined ? undefined : [...operation.evidenceIds].sort(),
          },
    )
    .sort(compareFileOperations)
  const content = { ...input, projects, sources, edits, evidence }
  return fileOperations === undefined ? content : { ...content, fileOperations }
}

export const finalizePlan = (input: PlanInput): Effect.Effect<TransformationPlan, PlanBuildError> =>
  Effect.gen(function* () {
    yield* validateInput(input)
    const content = canonicalizeContent(input)
    const provisional: TransformationPlan = {
      schemaVersion: 1,
      planId: "",
      ...content,
      snapshotHash: snapshotHashOf(content),
    }
    return { ...provisional, planId: planHashOf(provisional) }
  })
