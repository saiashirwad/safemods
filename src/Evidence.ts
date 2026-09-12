/** Evidence records attached to plans, and their canonical identity. */
import { Data, Effect, Predicate, Schema } from "effect"

export type EvidenceFact = string | number | boolean | null

export interface QueryEvidence {
  readonly criterion: string
  readonly facts: Readonly<Record<string, EvidenceFact>>
}

export const EvidenceRecord = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  facts: Schema.Record(Schema.String, Schema.Json),
})
export type EvidenceRecord = typeof EvidenceRecord.Type

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const canonicalJson = (value: Schema.Json): string =>
  JSON.stringify(value, (_, v: Schema.Json) =>
    Predicate.isObject(v) && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compareStrings(a, b)))
      : v,
  )

export class DraftEvidenceConflict extends Data.TaggedError("DraftEvidenceConflict")<{
  readonly id: string
}> {}

export class MissingDraftEvidence extends Data.TaggedError("MissingDraftEvidence")<{
  readonly id: string
}> {}

const evidenceIdentity = (record: EvidenceRecord): string =>
  `${record.kind}\0${canonicalJson(record.facts)}`

export const mergeEvidence = (
  records: ReadonlyArray<EvidenceRecord>,
): Effect.Effect<ReadonlyArray<EvidenceRecord>, DraftEvidenceConflict> =>
  Effect.gen(function* () {
    const evidence = new Map<string, EvidenceRecord>()
    for (const record of records) {
      const existing = evidence.get(record.id)
      if (existing === undefined) {
        evidence.set(record.id, record)
        continue
      }
      if (evidenceIdentity(existing) !== evidenceIdentity(record)) {
        return yield* new DraftEvidenceConflict({ id: record.id })
      }
    }
    return [...evidence.values()]
  })

interface EvidenceReference {
  readonly evidenceIds?: ReadonlyArray<string> | undefined
}

interface DraftEvidenceTarget {
  readonly edits: ReadonlyArray<EvidenceReference>
  readonly fileOperations?: ReadonlyArray<EvidenceReference> | undefined
  readonly evidence: ReadonlyArray<EvidenceRecord>
}

export const finalizeDraftEvidence = <A extends DraftEvidenceTarget>(
  draft: A,
): Effect.Effect<A, DraftEvidenceConflict | MissingDraftEvidence> =>
  Effect.gen(function* () {
    const merged = yield* mergeEvidence(draft.evidence)
    const evidenceIds = new Set(merged.map((record) => record.id))
    const referencedIds = [
      ...draft.edits.flatMap((edit) => edit.evidenceIds ?? []),
      ...(draft.fileOperations ?? []).flatMap((operation) => operation.evidenceIds ?? []),
    ]
    for (const id of referencedIds) {
      if (evidenceIds.has(id)) continue
      return yield* new MissingDraftEvidence({ id })
    }
    return { ...draft, evidence: merged }
  })
