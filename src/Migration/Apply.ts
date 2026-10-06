import {
  type Cause,
  Crypto,
  Data,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  type PlatformError,
} from "effect"
import * as Sha256 from "../Sha256.ts"
import type { FilePreview, FileState, MigrationPreview } from "./Preview.ts"
import { StaleMigrationError } from "./Errors.ts"
import { Workspace } from "../Workspace/index.ts"

export interface ApplicationOperationFailure {
  readonly phase: "commit" | "rollback" | "cleanup"
  readonly operation: "write" | "remove" | "restore" | "cleanup-temporary" | "cleanup-backup"
  readonly path: string
  readonly cause: Cause.Cause<PlatformError.PlatformError | RecoveryConflict>
}

export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{
  readonly reason: "path-escape" | "filesystem" | "recovery" | "committed"
  readonly cause?: unknown
  readonly failures?: ReadonlyArray<ApplicationOperationFailure>
}> {}

export interface ApplicationReceipt {
  readonly written: ReadonlyArray<FilePreview>
  readonly removed: ReadonlyArray<FilePreview>
}

interface Target {
  readonly file: FilePreview
  readonly path: string
  readonly mode: number | undefined
}

class RecoveryConflict extends Data.TaggedError("RecoveryConflict")<{
  readonly target: string
  readonly anchor: string
}> {}

interface Journal {
  readonly backups: Array<{ readonly target: string; readonly backup: string }>
  readonly writes: Array<{ readonly target: string; readonly temporary: string }>
}

const failed = (cause: unknown) => new ApplicationFailure({ reason: "filesystem", cause })

const nearestExisting = (
  target: string,
): Effect.Effect<string, ApplicationFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const exists = yield* fs.exists(target).pipe(Effect.mapError(failed))
    return exists ? target : yield* nearestExisting(path.dirname(target))
  })

const confine = Effect.fn("Application.confine")(function* (file: FilePreview) {
  const workspace = yield* Workspace
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const target = workspace.absolutePath(file.fileName)
  const realWorkspace = yield* fs.realPath(workspace.root).pipe(Effect.mapError(failed))
  const realAnchor = yield* fs.realPath(yield* nearestExisting(target)).pipe(
    Effect.mapError(failed),
  )
  const relative = path.relative(realWorkspace, realAnchor)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return yield* new ApplicationFailure({ reason: "path-escape" })
  }
  return target
})

const requireState = Effect.fn("Application.requireState")(function* (
  file: FilePreview,
  target: string,
  expected: FileState,
) {
  const fs = yield* FileSystem.FileSystem
  const stale = new StaleMigrationError({ path: file.fileName })
  const exists = yield* fs.exists(target).pipe(Effect.mapError(failed))
  if (exists !== expected.exists) return yield* stale
  if (!expected.exists) return
  const bytes = yield* fs.readFile(target).pipe(Effect.mapError(failed))
  if (Sha256.digest(bytes) !== Sha256.digest(expected.bytes)) return yield* stale
})

const preflight = Effect.fn("Application.preflight")(function* (preview: MigrationPreview) {
  const fs = yield* FileSystem.FileSystem
  const sources = new Map<string, string>()
  for (const source of preview.sources) {
    const target = yield* confine(source)
    yield* requireState(source, target, source.before)
    sources.set(source.fileName, target)
  }
  const targets: Array<Target> = []
  for (const file of preview.files) {
    const path = yield* confine(file)
    const modeSource = file.movedFrom !== undefined ?
      sources.get(file.movedFrom) :
      file.before.exists ?
      path :
      undefined
    const mode = modeSource === undefined ?
      undefined :
      (yield* fs.stat(modeSource).pipe(Effect.mapError(failed))).mode
    targets.push({ file, path, mode })
  }
  return targets
})

const uniqueName = (target: string, suffix: string) =>
  Effect.map(
    Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv4),
    (id) => `${target}.safemods-${id}.${suffix}`,
  ).pipe(Effect.mapError(failed))

const moveAside = Effect.fn("Application.moveAside")(function* (target: Target, journal: Journal) {
  const fs = yield* FileSystem.FileSystem
  yield* requireState(target.file, target.path, target.file.before)
  if (!target.file.before.exists) return
  const backup = yield* uniqueName(target.path, "backup")
  yield* confine(target.file)
  journal.backups.push({ target: target.path, backup })
  yield* fs.rename(target.path, backup).pipe(Effect.mapError(failed))
})

const write = Effect.fn("Application.write")(function* (target: Target, journal: Journal) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* requireState(target.file, target.path, { exists: false })
  if (!target.file.after.exists) return
  yield* fs.makeDirectory(path.dirname(target.path), { recursive: true }).pipe(
    Effect.mapError(failed),
  )
  const temporary = yield* uniqueName(target.path, "tmp")
  yield* confine(target.file)
  journal.writes.push({ target: target.path, temporary })
  yield* fs.writeFile(temporary, target.file.after.bytes, { flag: "wx", mode: target.mode }).pipe(
    Effect.mapError(failed),
  )
  if (target.mode !== undefined) {
    yield* fs.chmod(temporary, target.mode).pipe(Effect.mapError(failed))
  }
  yield* fs.link(temporary, target.path).pipe(Effect.mapError(failed))
})

const attempt = (
  phase: ApplicationOperationFailure["phase"],
  operation: ApplicationOperationFailure["operation"],
  path: string,
  action: Effect.Effect<void, PlatformError.PlatformError | RecoveryConflict>,
) =>
  Effect.map(
    Effect.exit(action),
    (exit): ReadonlyArray<ApplicationOperationFailure> =>
      Exit.isSuccess(exit) ? [] : [{ phase, operation, path, cause: exit.cause }],
  )

const rollback = Effect.fn("Application.rollback")(function* (
  journal: Journal,
  cause: Cause.Cause<ApplicationFailure | StaleMigrationError>,
): Effect.fn.Return<never, ApplicationFailure | StaleMigrationError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem
  const failures = [
    ...(yield* Effect.forEach(
      journal.writes.toReversed(),
      ({ target, temporary }) =>
        Effect.gen(function* () {
          const failures = yield* attempt(
            "rollback",
            "remove",
            target,
            Effect.gen(function* () {
              if (yield* fs.exists(target)) {
                if (!(yield* fs.exists(temporary))) {
                  return yield* new RecoveryConflict({ target, anchor: temporary })
                }
                const installed = yield* fs.stat(target)
                const staged = yield* fs.stat(temporary)
                if (
                  installed.dev !== staged.dev || Option.isNone(installed.ino) ||
                  Option.isNone(staged.ino) || installed.ino.value !== staged.ino.value
                ) {
                  return yield* new RecoveryConflict({ target, anchor: temporary })
                }
                yield* fs.remove(target)
              }
            }),
          )
          if (failures.length > 0) return failures
          return yield* attempt(
            "rollback",
            "cleanup-temporary",
            temporary,
            fs.remove(temporary, { force: true }),
          )
        }),
    )),
    ...(yield* Effect.forEach(
      journal.backups.toReversed(),
      ({ target, backup }) =>
        attempt(
          "rollback",
          "restore",
          backup,
          Effect.gen(function* () {
            if (!(yield* fs.exists(backup))) {
              if (yield* fs.exists(target)) return
              return yield* new RecoveryConflict({ target, anchor: backup })
            }
            yield* fs.link(backup, target)
            yield* fs.remove(backup)
          }),
        ),
    )),
  ].flat()
  if (failures.length > 0) {
    return yield* new ApplicationFailure({ reason: "recovery", cause, failures })
  }
  return yield* Effect.failCause(cause)
})

const cleanup = Effect.fn("Application.cleanup")(function* (journal: Journal) {
  const fs = yield* FileSystem.FileSystem
  const failures = [
    ...(yield* Effect.forEach(
      journal.backups,
      ({ backup }) =>
        attempt("cleanup", "cleanup-backup", backup, fs.remove(backup, { force: true })),
    )),
    ...(yield* Effect.forEach(
      journal.writes,
      ({ temporary }) =>
        attempt("cleanup", "cleanup-temporary", temporary, fs.remove(temporary, { force: true })),
    )),
  ].flat()
  if (failures.length > 0) {
    return yield* new ApplicationFailure({ reason: "committed", failures })
  }
})

export const apply = Effect.fn("Application.apply")(function* (
  preview: MigrationPreview,
) {
  const targets = yield* preflight(preview)
  const journal: Journal = { backups: [], writes: [] }
  const commit = Effect.gen(function* () {
    for (const target of targets) yield* moveAside(target, journal)
    for (const target of targets) yield* write(target, journal)
  })
  yield* Effect.uninterruptibleMask((restore) =>
    restore(commit).pipe(
      Effect.catchCause((cause) => rollback(journal, cause)),
      Effect.andThen(cleanup(journal)),
    )
  )
  return {
    written: preview.files.filter((file) => file.after.exists),
    removed: preview.files.filter((file) => !file.after.exists),
  } satisfies ApplicationReceipt
})
