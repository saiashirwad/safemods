import { ApplicationFailure } from "../../Application/Application.ts"

export type ApplicationFailureResult = ApplicationFailure

export const toApplicationFailure =
  (planId: string, rolledBack = false) =>
  (cause: unknown): ApplicationFailure =>
    new ApplicationFailure({ planId, cause, rolledBack })
