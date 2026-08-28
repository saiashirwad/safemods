import { ApplicationFailure } from "../../Application/Application.ts"
import { StalePlanError } from "../../Verification/Errors.ts"

export const toApplicationFailure = (planId: string, cause: unknown): ApplicationFailure =>
  new ApplicationFailure({ planId, cause })

export const preserveStalePlanError =
  (planId: string) =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Shared mapper preserves the typed stale error and wraps every other Effect failure cause.
  (error: unknown): ApplicationFailure | StalePlanError =>
    error instanceof StalePlanError ? error : toApplicationFailure(planId, error)
