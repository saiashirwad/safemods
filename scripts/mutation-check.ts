/**
 * Mutation smoke check: prove the suite fails when core behavior changes.
 *
 * Each mutant flips one behavior in `src/`. The named test file must fail while
 * the mutant is in place. A test that still passes means it does not observe the
 * behavior, so the mutant "survives" and this script exits non-zero.
 *
 * The working tree is restored after every mutant and on interruption.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Path, Runtime } from "effect"
import { runCommand } from "./run-command.ts"

interface Mutant {
  readonly name: string
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly test: string
}

const mutants: ReadonlyArray<Mutant> = [
  {
    name: "Edit rejects an edit whose captured source text changed",
    file: "src/Edit.ts",
    find:
      `      if (Sha256.digest(sourceText.slice(edit.start, edit.end)) !== edit.expectedTextHash) {`,
    replace:
      `      if (Sha256.digest(sourceText.slice(edit.start, edit.end)) === edit.expectedTextHash) {`,
    test: "test/Edit.test.ts",
  },
  {
    name: "Edit rejects overlapping replacements",
    file: "src/Edit.ts",
    find: `  return left.start < right.end && right.start < left.end`,
    replace: `  return false`,
    test: "test/Edit.test.ts",
  },
  {
    name: "Position.offset converts a line and column to an offset",
    file: "src/Position.ts",
    find:
      `  return before.reduce((total, lineText) => total + lineText.length + 1, 0) + column - 1`,
    replace: `  return before.reduce((total, lineText) => total + lineText.length + 1, 0) + column`,
    test: "test/Position.test.ts",
  },
  {
    name: "layers allows an import from the same layer",
    file: "src/Checks/Layers.ts",
    find: `          return from === undefined || to === undefined || to <= from ?`,
    replace: `          return from === undefined || to === undefined || to < from ?`,
    test: "test/checks/layers.test.ts",
  },
  {
    name: "ModuleSpecifier.parse recognizes a parent path as relative",
    file: "src/ModuleSpecifier.ts",
    find: `/^\\.\\.?(?:\\/|$)/`,
    replace: `/^\\.(?:\\/|$)/`,
    test: "test/ModuleSpecifier.test.ts",
  },
  {
    name: "Overlay.readFile hides a deleted file",
    file: "src/Workspace/Overlay.ts",
    find:
      `      return deleted.has(resolved) ? null : files.get(resolved) ?? base.readFile(resolved)`,
    replace: `      return files.get(resolved) ?? base.readFile(resolved)`,
    test: "test/Workspace.test.ts",
  },
  {
    name: "Diagnostics distinguishes errors that differ only by message",
    file: "src/Migration/Diagnostics.ts",
    find: `  left.code === right.code && left.message === right.message`,
    replace: `  left.code === right.code && true`,
    test: "test/Verification.test.ts",
  },
  {
    name: "Apply refuses a path that escapes the workspace",
    file: "src/Migration/Apply.ts",
    find: `  const relative = path.relative(realWorkspace, realAnchor)`,
    replace: `  const relative = ""`,
    test: "test/Application.test.ts",
  },
  {
    name: "Apply rejects a file that changed after verification",
    file: "src/Migration/Apply.ts",
    find: `  if (Sha256.digest(bytes) !== Sha256.digest(expected.bytes)) return yield* stale`,
    replace: `  if (Sha256.digest(bytes) === Sha256.digest(expected.bytes)) return yield* stale`,
    test: "test/Application.test.ts",
  },
]

class MutationCheckFailed extends Data.TaggedError("MutationCheckFailed")<{
  readonly message: string
}> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL("..", import.meta.url))
  const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs")
  const runTest = (test: string) => runCommand(process.execPath, [vitest, "run", test], root)

  const runMutant = (mutant: Mutant) =>
    Effect.gen(function* () {
      const file = path.resolve(root, mutant.file)
      const original = yield* fs.readFileString(file)
      const anchors = original.split(mutant.find).length - 1
      if (anchors !== 1) {
        return yield* new MutationCheckFailed({
          message: `${mutant.file}: mutation anchor must appear exactly once`,
        })
      }
      return yield* Effect.gen(function* () {
        yield* fs.writeFileString(file, original.replace(mutant.find, mutant.replace))
        return yield* runTest(mutant.test)
      }).pipe(Effect.ensuring(fs.writeFileString(file, original).pipe(Effect.orDie)))
    })

  // A test that fails on its own would make every mutant on it look killed, so
  // prove each one passes once before trusting a failure to mean the mutant died.
  const tests = Array.from(new Set(mutants.map((mutant) => mutant.test)))
  yield* Effect.forEach(
    tests,
    (test) =>
      runTest(test).pipe(
        Effect.flatMap(({ exitCode, stdout, stderr }) =>
          exitCode === 0 ?
            Effect.void :
            Effect.fail(
              new MutationCheckFailed({
                message: `${test} fails without a mutant:\n${stdout}\n${stderr}`,
              }),
            )
        ),
      ),
    { concurrency: 1, discard: true },
  )

  const outcomes = yield* Effect.forEach(
    mutants,
    (mutant) =>
      runMutant(mutant).pipe(
        Effect.map(({ exitCode }) => ({ mutant, killed: exitCode !== 0 })),
        Effect.tap(({ mutant, killed }) =>
          Console.log(
            killed ? `killed    ${mutant.name}` : `survived  ${mutant.name}  (${mutant.test})`,
          )
        ),
      ),
    { concurrency: 1 },
  )

  const survivors = outcomes.filter((outcome) => !outcome.killed).map((outcome) => outcome.mutant)
  if (survivors.length > 0) {
    return yield* new MutationCheckFailed({
      message: [
        `${survivors.length} of ${mutants.length} mutants survived; the suite does not detect them:`,
        ...survivors.map((survivor) => `  ${survivor.file}: ${survivor.name}`),
      ].join("\n"),
    })
  }
  yield* Console.log(`\nAll ${mutants.length} mutants killed.`)
})

const report = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catch((error) =>
      error instanceof MutationCheckFailed ?
        Effect.andThen(Console.error(error.message), Effect.fail(error)) :
        Effect.fail(error)
    ),
  )

NodeRuntime.runMain(report(program).pipe(Effect.provide(NodeServices.layer)))
