/**
 * Draft domain — immutable proposed transformations.
 *
 * A Draft is an immutable value: the edits a recipe proposes plus the
 * evidence that explains them and the primary-run match measurement. Authors
 * never compute ranges, hashes, file identity, or evidence IDs — every edit
 * is declared against a native node or a Selection, and the builder derives
 * the durable guard data from the snapshot. Finalization (ordering, conflict
 * rejection, plan identity) belongs to the engine in `Recipe.run`.
 */
import { Effect, Predicate } from "effect"
import {
  type DraftEvidenceConflict,
  type MissingDraftEvidence,
  finalizeDraftEvidence,
  type EvidenceRecord,
} from "../Evidence.ts"
import type { PlannedFileOperation } from "../Plan.ts"
import type { Node, SourceFile } from "typescript/unstable/ast"
import { textEdit, type TextEdit } from "../Edit.ts"
import type { Selection } from "../Query/index.ts"
import type { ProjectSnapshot, SnapshotExpired } from "../Workspace/index.ts"

export interface Draft {
  readonly edits: ReadonlyArray<TextEdit>
  readonly fileOperations?: ReadonlyArray<PlannedFileOperation>
  readonly evidence: ReadonlyArray<EvidenceRecord>
  /** Number of matched source targets represented by this draft. */
  readonly matches: number
}

export const empty: Draft = { edits: [], fileOperations: [], evidence: [], matches: 0 }

/**
 * Combine drafts built from disjoint selections. Identical evidence records
 * merge; records sharing an ID with different facts are rejected.
 */
export const concat = (
  ...drafts: ReadonlyArray<Draft>
): Effect.Effect<Draft, DraftEvidenceConflict | MissingDraftEvidence> =>
  finalizeDraftEvidence({
    edits: drafts.flatMap((draft) => draft.edits),
    fileOperations: drafts.flatMap((draft) => draft.fileOperations ?? []),
    evidence: drafts.flatMap((draft) => draft.evidence),
    matches: drafts.reduce((total, draft) => total + draft.matches, 0),
  })

const textEditForRange = (
  project: ProjectSnapshot,
  sourceFile: SourceFile,
  start: number,
  end: number,
  newText: string,
): TextEdit =>
  textEdit({
    projectId: project.project.id,
    fileName: project.pathOf(sourceFile),
    sourceText: sourceFile.text,
    start,
    end,
    newText,
  })

/** Draft replacing a node-derived range, evaluated inside the snapshot's native scope. */
const draftForNodeRange = (
  project: ProjectSnapshot,
  node: Node,
  newText: string,
  operation: string,
  range: (sourceFile: SourceFile) => { readonly start: number; readonly end: number },
): Effect.Effect<Draft, SnapshotExpired> =>
  project.unsafeNative(() =>
    Effect.sync(() => {
      const sourceFile = node.getSourceFile()
      const { start, end } = range(sourceFile)
      const edit = textEditForRange(project, sourceFile, start, end, newText)
      const evidenceId = `${operation}:${edit.projectId}:${edit.fileName}:${edit.start}-${edit.end}`
      return {
        edits: [{ ...edit, evidenceIds: [evidenceId] }],
        evidence: [
          {
            id: evidenceId,
            kind: "draft-operation",
            facts: {
              operation,
              projectId: edit.projectId,
              fileName: edit.fileName,
              start: edit.start,
              end: edit.end,
            },
          },
        ],
        matches: 1,
      }
    }),
  )

export const replace = (
  project: ProjectSnapshot,
  node: Node,
  newText: string,
): Effect.Effect<Draft, SnapshotExpired> =>
  draftForNodeRange(project, node, newText, "node:replace", (sourceFile) => ({
    start: node.getStart(sourceFile),
    end: node.getEnd(),
  }))

export const remove = (
  project: ProjectSnapshot,
  node: Node,
): Effect.Effect<Draft, SnapshotExpired> => replace(project, node, "")

export const insertBefore = (
  project: ProjectSnapshot,
  node: Node,
  text: string,
): Effect.Effect<Draft, SnapshotExpired> => insertAtNode(project, node, text, "before")

export const insertAfter = (
  project: ProjectSnapshot,
  node: Node,
  text: string,
): Effect.Effect<Draft, SnapshotExpired> => insertAtNode(project, node, text, "after")

const insertAtNode = (
  project: ProjectSnapshot,
  node: Node,
  text: string,
  side: "before" | "after",
): Effect.Effect<Draft, SnapshotExpired> =>
  draftForNodeRange(project, node, text, `node:insert-${side}`, (sourceFile) => {
    const position = side === "before" ? node.getStart(sourceFile) : node.getEnd()
    return { start: position, end: position }
  })

/** The replacement a selection maps to: text only (replace the selected node) or an explicit target node. */
export type Replacement = string | { readonly node: Node; readonly text: string }

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Type guard boundary for candidate draft values.
const isDraft = (value: unknown): value is Draft =>
  Predicate.isObject(value) && "edits" in value && "evidence" in value && "matches" in value

/** A returned Draft with no edits, operations, evidence, or matches is `empty`. */
const isCompletelyEmpty = (draft: Draft): boolean =>
  draft.edits.length === 0 &&
  (draft.fileOperations?.length ?? 0) === 0 &&
  draft.evidence.length === 0 &&
  draft.matches === 0

/**
 * A returned `Draft.empty` still counts as one selected occurrence: match
 * policies and scan audits count the selection, not whether an edit was
 * produced.
 */
const emptySelectionDraft = <A extends Node>(
  selection: Selection<A>,
  evidenceId: string,
): Draft => ({
  edits: [],
  fileOperations: [],
  evidence: [selectionEvidence(selection, evidenceId)],
  matches: 1,
})

/** Fold a returned Draft into the selection, tagging its records with the selection's evidence. */
const adoptReturnedDraft = <A extends Node>(
  selection: Selection<A>,
  evidenceId: string,
  proposed: Draft,
): Effect.Effect<Draft, DraftEvidenceConflict | MissingDraftEvidence> =>
  finalizeDraftEvidence({
    edits: proposed.edits.map((edit) => ({
      ...edit,
      evidenceIds: [...new Set([...edit.evidenceIds, evidenceId])],
    })),
    fileOperations: (proposed.fileOperations ?? []).map((operation) => ({
      ...operation,
      evidenceIds: [...new Set([...operation.evidenceIds, evidenceId])],
    })),
    evidence: [...proposed.evidence, selectionEvidence(selection, evidenceId)],
    matches: 1,
  })

const draftFromProposal = <A extends Node>(
  selection: Selection<A>,
  proposed: Replacement | Draft,
): Effect.Effect<Draft, SnapshotExpired | DraftEvidenceConflict | MissingDraftEvidence> => {
  const evidenceId = selectionEvidenceId(selection)
  if (isDraft(proposed)) {
    if (isCompletelyEmpty(proposed)) {
      return Effect.succeed(emptySelectionDraft(selection, evidenceId))
    }
    return adoptReturnedDraft(selection, evidenceId, proposed)
  }
  const node = Predicate.isString(proposed) ? selection.value : proposed.node
  const text = Predicate.isString(proposed) ? proposed : proposed.text
  return selection.project.unsafeNative(() =>
    Effect.sync(() => {
      const sourceFile = node.getSourceFile()
      const edit = textEditForRange(
        selection.project,
        sourceFile,
        node.getStart(sourceFile),
        node.getEnd(),
        text,
      )
      return {
        edits: [{ ...edit, evidenceIds: [evidenceId] }],
        evidence: [selectionEvidence(selection, evidenceId)],
        matches: 1,
      }
    }),
  )
}

/**
 * Propose one replacement per selection. Each edit inherits its selection's
 * Query Evidence automatically; the draft records the selection count as the
 * primary-run match measurement.
 */
export const replaceEach = <A extends Node, E = never, R = never>(
  selections: ReadonlyArray<Selection<A>>,
  replacement: (
    selection: Selection<A>,
  ) => Replacement | Draft | Effect.Effect<Replacement | Draft, E, R>,
): Effect.Effect<Draft, E | SnapshotExpired | DraftEvidenceConflict | MissingDraftEvidence, R> =>
  Effect.forEach(selections, (selection) => {
    const raw = replacement(selection)
    const effect: Effect.Effect<Replacement | Draft, E, R> = Effect.isEffect(raw)
      ? raw
      : Effect.succeed(raw)
    return Effect.flatMap(effect, (proposed) => draftFromProposal(selection, proposed))
  }).pipe(Effect.flatMap((drafts) => concat(...drafts)))

const selectionEvidenceId = <A extends Node>(selection: Selection<A>): string =>
  `selection:${selection.project.project.id}:${selection.fileName}:${selection.start}-${selection.end}`

const selectionEvidence = <A extends Node>(
  selection: Selection<A>,
  evidenceId = selectionEvidenceId(selection),
): EvidenceRecord => ({
  id: evidenceId,
  kind: "selection",
  facts: {
    projectId: selection.project.project.id,
    fileName: selection.fileName,
    start: selection.start,
    end: selection.end,
    criteria: selection.evidence.map((item) => ({
      criterion: item.criterion,
      facts: { ...item.facts },
    })),
  },
})
