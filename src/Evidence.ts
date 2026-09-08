/** Evidence records attached to plans, and their canonical identity. */
import { Data, Effect, Predicate } from "effect"

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

export type EvidenceFact = string | number | boolean | null

export interface QueryEvidence {
  readonly criterion: string
  readonly facts: Readonly<Record<string, EvidenceFact>>
}

export interface EvidenceRecord {
  readonly id: string
  readonly kind: string
  readonly facts: { readonly [key: string]: Json }
}

export const canonicalJson = (value: Json): string =>
  JSON.stringify(value, (_, v: Json) =>
    Predicate.isObject(v) && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )

export class DraftEvidenceConflict extends Data.TaggedError("DraftEvidenceConflict")<{
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

interface MissingEvidence {
  readonly kind?: string | undefined
  readonly facts?: EvidenceRecord["facts"] | undefined
}

export const finalizeDraftEvidence = <A extends DraftEvidenceTarget>(
  draft: A,
  missing: MissingEvidence = {},
): Effect.Effect<A, DraftEvidenceConflict> =>
  Effect.gen(function* () {
    const merged = yield* mergeEvidence(draft.evidence)
    const evidence = new Map(merged.map((record) => [record.id, record]))
    const referencedIds = [
      ...draft.edits.flatMap((edit) => edit.evidenceIds ?? []),
      ...(draft.fileOperations ?? []).flatMap((operation) => operation.evidenceIds ?? []),
    ]
    for (const id of referencedIds) {
      if (evidence.has(id)) continue
      evidence.set(id, {
        id,
        kind: missing.kind ?? "draft-operation",
        facts: missing.facts ?? {},
      })
    }
    return { ...draft, evidence: [...evidence.values()] }
  })
