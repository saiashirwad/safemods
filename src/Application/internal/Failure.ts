import { ApplicationFailure } from "../../Application/Application.ts"

export const toApplicationFailure = (planId: string, cause: unknown): ApplicationFailure =>
  new ApplicationFailure({ planId, cause })
