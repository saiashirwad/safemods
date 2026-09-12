import { Data, type Effect, type Stream } from "effect"
import type { EvidenceFact, QueryEvidence } from "../Evidence.ts"
import type { ProjectRelativePath } from "../ProjectPath.ts"
import type { ProjectFile, ProjectSnapshot } from "../Workspace/index.ts"

export type ProjectScope = ProjectSnapshot | ProjectFile | ReadonlyArray<ProjectFile>

export interface Selection<A> {
  readonly value: A
  readonly project: ProjectSnapshot
  readonly fileName: ProjectRelativePath
  readonly start: number
  readonly end: number
  readonly evidence: ReadonlyArray<QueryEvidence>
}

export type Query<A, E = never, R = never> = Stream.Stream<Selection<A>, E, R>

export class QueryContractError extends Data.TaggedError("QueryContractError")<{
  readonly criterion: string
  readonly expected: number
  readonly actual: number
}> {}

export interface Criterion<A, E = never, R = never> {
  readonly id: string
  readonly batchSize?: number
  readonly select: (
    selections: ReadonlyArray<Selection<A>>,
  ) => Effect.Effect<ReadonlyArray<Readonly<Record<string, EvidenceFact>> | undefined>, E, R>
}
