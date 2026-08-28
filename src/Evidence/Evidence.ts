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
