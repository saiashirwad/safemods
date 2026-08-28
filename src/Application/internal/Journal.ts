import { randomUUID } from "node:crypto"
import { Effect, FileSystem, Schema } from "effect"
import type { ApplicationFailure } from "../../Application/Application.ts"
import { toApplicationFailure } from "./Failure.ts"

export const APPLY_JOURNAL_NAME = ".safemods-apply.journal"

export interface JournalBeforeState {
  readonly exists: boolean
  readonly text?: string | undefined
}

export interface JournalEntry {
  readonly target: string
  readonly temporary?: string | undefined
  readonly before: JournalBeforeState
}

export interface TransactionJournal {
  readonly planId: string
  readonly phase: "open" | "committed"
  readonly files: ReadonlyArray<JournalEntry>
  readonly createdDirectories: ReadonlyArray<string>
}

const JournalBeforeStateSchema = Schema.Struct({
  exists: Schema.Boolean,
  text: Schema.optional(Schema.String),
})

const JournalEntrySchema = Schema.Struct({
  target: Schema.String,
  temporary: Schema.optional(Schema.String),
  before: JournalBeforeStateSchema,
})

const TransactionJournalSchema = Schema.Struct({
  planId: Schema.String,
  phase: Schema.Union([Schema.Literal("open"), Schema.Literal("committed")]),
  files: Schema.Array(JournalEntrySchema),
  createdDirectories: Schema.Array(Schema.String),
})

const decodeJournal = Schema.decodeUnknownSync(TransactionJournalSchema)

export const parseJournal = (text: string): TransactionJournal | undefined => {
  try {
    return decodeJournal(JSON.parse(text))
  } catch {
    return undefined
  }
}

export const persistJournal = (
  journalPath: string,
  journal: TransactionJournal,
): Effect.Effect<void, ApplicationFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const temporary = `${journalPath}.${randomUUID()}.tmp`
    yield* fs
      .writeFileString(temporary, JSON.stringify(journal), { flag: "wx" })
      .pipe(Effect.mapError((cause) => toApplicationFailure(journal.planId, cause)))
    yield* fs.rename(temporary, journalPath).pipe(
      Effect.mapError((cause) => toApplicationFailure(journal.planId, cause)),
      Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
    )
  })
