/** Public Query API and Criterion namespace. Implementations live in focused modules. */
import { CriterionBase, type Criterion as CriterionModel } from "./Query.ts"
import { RelationCriterion } from "./Relations.ts"

export { QueryContractError } from "./Query.ts"
export type { ProjectScope, Query, Selection, TargetFileScope } from "./Query.ts"
export * from "./Sources.ts"
export * from "./Operators.ts"
export type { HasOptions, InsideOptions, RelationalMatcher, SiblingOptions } from "./Relations.ts"
export * from "./Semantic.ts"

export type Criterion<A, E = never, R = never> = CriterionModel<A, E, R>

export const Criterion = { ...CriterionBase, ...RelationCriterion }
