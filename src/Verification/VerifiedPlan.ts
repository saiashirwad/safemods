import { Predicate } from "effect"
import type { ValidatedPlan } from "../Plan.ts"
import type { Workspace } from "../Workspace/index.ts"
import type { DiagnosticDiff } from "./Diagnostics.ts"
import type { FilePreview, FileState, PlanPreview } from "./Preview.ts"

declare const VerifiedPlanTypeId: unique symbol

export type PublicFileState =
  | { readonly exists: false }
  | { readonly exists: true; readonly text: string }

export interface PublicFilePreview extends Omit<FilePreview, "before" | "after"> {
  readonly before: PublicFileState
  readonly after: PublicFileState
}

export interface PublicPlanPreview extends Omit<PlanPreview, "sources" | "files"> {
  readonly sources: ReadonlyArray<PublicFilePreview>
  readonly files: ReadonlyArray<PublicFilePreview>
}

export interface VerifiedPlan {
  readonly [VerifiedPlanTypeId]: true
  readonly preview: PublicPlanPreview
  readonly diagnosticDiff: DiagnosticDiff
}

interface ApplicationState {
  readonly workspace: Workspace["Service"]
  readonly plan: ValidatedPlan
  readonly preview: PlanPreview
}

const issued = new WeakMap<object, ApplicationState>()

const deepFreeze = <A>(value: A): A => {
  if (ArrayBuffer.isView(value)) return value
  if (Array.isArray(value) || Predicate.isObject(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const cloneFileState = (state: FileState): FileState =>
  state.exists ? { exists: true, text: state.text, bytes: state.bytes } : state

const cloneFilePreview = ({ before, after, ...file }: FilePreview): FilePreview => ({
  ...file,
  before: cloneFileState(before),
  after: cloneFileState(after),
})

const clonePreview = (preview: PlanPreview): PlanPreview => ({
  planId: preview.planId,
  sources: preview.sources.map(cloneFilePreview),
  files: preview.files.map(cloneFilePreview),
})

const publicFileState = (state: FileState): PublicFileState =>
  state.exists ? { exists: true, text: state.text } : state

const publicFilePreview = ({ before, after, ...file }: FilePreview): PublicFilePreview => ({
  ...file,
  before: publicFileState(before),
  after: publicFileState(after),
})

const publicPreview = (preview: PlanPreview): PublicPlanPreview => ({
  planId: preview.planId,
  sources: preview.sources.map(publicFilePreview),
  files: preview.files.map(publicFilePreview),
})

export const issue = (
  workspace: Workspace["Service"],
  plan: ValidatedPlan,
  preview: PlanPreview,
  diagnosticDiff: DiagnosticDiff,
): VerifiedPlan => {
  const verified = Object.freeze({
    preview: deepFreeze(publicPreview(preview)),
    diagnosticDiff: deepFreeze(diagnosticDiff),
  }) as VerifiedPlan
  issued.set(verified, { workspace, plan, preview: clonePreview(preview) })
  return verified
}

export const applicationState = (verified: VerifiedPlan): ApplicationState | undefined =>
  issued.get(verified)
