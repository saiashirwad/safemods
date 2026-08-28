import { CriterionBase, type Criterion as CriterionModel } from "./Query.ts"
import { RelationCriterion } from "./Relations.ts"

export { QueryContractError } from "./Query.ts"
export type { ProjectScope, Query, Selection, TargetFileScope } from "./Query.ts"
export * from "./Sources.ts"
export * from "./Operators.ts"
export type { RelationalMatcher, SiblingOptions, StopOptions } from "./Relations.ts"
export * from "./Semantic.ts"

export type Criterion<A, E = never, R = never> = CriterionModel<A, E, R>

export const Criterion = { ...CriterionBase, ...RelationCriterion }
