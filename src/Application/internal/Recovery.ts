import { randomUUID } from "node:crypto"
import { Effect, FileSystem, Path, Schema } from "effect"
import type { ApplicationFailure } from "../../Application/Application.ts"
import { toApplicationFailure } from "./Failure.ts"
import { isPathContained, resolveContainedProjectPath } from "../../ProjectPath/index.ts"

/** Durable before-state journal for an in-flight apply; recovery replays it. */
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

const parseJournal = (text: string): TransactionJournal | undefined => {
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

const isSafemodsTemporaryName = (name: string): boolean =>
  name.includes(".safemods-") && name.endsWith(".tmp")

const sweepSafemodsTemporaries = (
  workspaceRoot: string,
  planId: string,
): Effect.Effect<void, ApplicationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs
      .readDirectory(workspaceRoot, { recursive: true })
      .pipe(Effect.mapError((cause) => toApplicationFailure(planId, cause)))
    for (const name of names) {
      if (!isSafemodsTemporaryName(name)) continue
      const target = path.resolve(workspaceRoot, name)
      if (!isPathContained(path, workspaceRoot, target)) continue
      yield* fs.remove(target, { force: true }).pipe(Effect.ignore)
    }
  })

const restoreJournalEntry = (
  workspaceRoot: string,
  planId: string,
  entry: JournalEntry,
): Effect.Effect<void, ApplicationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (entry.temporary !== undefined) {
      const temporary = resolveContainedProjectPath(path, workspaceRoot, entry.temporary)
      if (temporary !== undefined) {
        yield* fs.remove(temporary, { force: true }).pipe(Effect.ignore)
      }
    }
    const target = resolveContainedProjectPath(path, workspaceRoot, entry.target)
    if (target === undefined) {
      return yield* toApplicationFailure(planId, `Journal path escapes workspace: ${entry.target}`)
    }
    yield* entry.before.exists
      ? fs
          .writeFileString(target, entry.before.text ?? "")
          .pipe(Effect.mapError((cause) => toApplicationFailure(planId, cause)))
      : fs.remove(target, { force: true }).pipe(Effect.ignore)
  })

export const recoverUnfinishedApplication = (
  workspaceRoot: string,
  planId: string,
): Effect.Effect<void, ApplicationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const journalPath = path.join(workspaceRoot, APPLY_JOURNAL_NAME)
    const exists = yield* fs
      .exists(journalPath)
      .pipe(Effect.mapError((cause) => toApplicationFailure(planId, cause)))
    if (exists) {
      const text = yield* fs
        .readFileString(journalPath)
        .pipe(Effect.mapError((cause) => toApplicationFailure(planId, cause)))
      const journal = parseJournal(text)
      if (journal !== undefined && journal.phase !== "committed") {
        for (const entry of journal.files) {
          yield* restoreJournalEntry(workspaceRoot, planId, entry)
        }
        for (const directory of [...journal.createdDirectories].reverse()) {
          const target = resolveContainedProjectPath(path, workspaceRoot, directory)
          if (target !== undefined) {
            yield* fs.remove(target, { force: true }).pipe(Effect.ignore)
          }
        }
      }
      yield* fs.remove(journalPath, { force: true }).pipe(Effect.ignore)
    }
    yield* sweepSafemodsTemporaries(workspaceRoot, planId)
  })
