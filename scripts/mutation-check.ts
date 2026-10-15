/**
 * Mutation smoke check: prove the suite fails when core behavior changes.
 *
 * Each mutant flips one behavior in `src/`. The named test file must fail while
 * the mutant is in place. A test that still passes means it does not observe the
 * behavior, so the mutant "survives" and this script exits non-zero.
 *
 * Usage: `node scripts/mutation-check.ts [--list | --only <mutant id>]`
 *   (no flag)       run every mutant
 *   --list          print each mutant id with its test file and exit
 *   --only <id>     run a single mutant
 *
 * Runtime: one vitest run per distinct test file (baseline) plus one per mutant,
 * so roughly a minute for the full set; `--only` runs two vitest invocations.
 *
 * Isolation: the repo is copied (minus node_modules, .git, coverage, dist) into a
 * temp directory with `node_modules` symlinked, and every mutation and test run
 * happens there. The working tree is never written and the temp copy is removed
 * on exit or interruption.
 *
 * Markers: a mutant is anchored by a `// mutant: <id>` comment on its own line,
 * directly above the line to mutate, in the mutant's `file`. `find` is replaced
 * by `replace` on that one line only, so moving or reformatting other code does
 * not break the gate. Every marker and `find` is validated before any test runs.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Data, Effect, FileSystem, Path, Runtime } from "effect"
import { runCommand } from "./run-command.ts"

interface Mutant {
  readonly id: string
  readonly file: string
  /** Substring of the marked line to replace; must occur exactly once on it. */
  readonly find: string
  readonly replace: string
  /** The behavior the mutant breaks, phrased to follow "does not fail when". */
  readonly breaks: string
  readonly test: string
}

const mutants: ReadonlyArray<Mutant> = [
  {
    id: "edit-source-mismatch",
    file: "src/Edit.ts",
    find: `Sha256.digest(sourceText.slice(edit.start, edit.end)) !== edit.expectedTextHash`,
    replace: `Sha256.digest(sourceText.slice(edit.start, edit.end)) === edit.expectedTextHash`,
    breaks: "an edit is applied although its captured source text changed",
    test: "test/Edit.test.ts",
  },
  {
    id: "edit-overlap",
    file: "src/Edit.ts",
    find: `return left.start < right.end && right.start < left.end`,
    replace: `return false`,
    breaks: "overlapping replacements are accepted",
    test: "test/Edit.test.ts",
  },
  {
    id: "position-offset",
    file: "src/Position.ts",
    find: `+ column - 1`,
    replace: `+ column`,
    breaks: "Position.offset is off by one for a line and column",
    test: "test/Position.test.ts",
  },
  {
    id: "layers-same-layer",
    file: "src/Checks/Layers.ts",
    find: `to <= from ?`,
    replace: `to < from ?`,
    breaks: "an import from the same layer is reported",
    test: "test/Checks/Layers.test.ts",
  },
  {
    id: "specifier-parent-relative",
    file: "src/ModuleSpecifier.ts",
    find: `/^\\.\\.?(?:\\/|$)/`,
    replace: `/^\\.(?:\\/|$)/`,
    breaks: "ModuleSpecifier.parse no longer treats a parent path as relative",
    test: "test/ModuleSpecifier.test.ts",
  },
  {
    id: "overlay-deleted-file",
    file: "src/Workspace/Overlay.ts",
    find: `deleted.has(resolved) ? null : files.get(resolved) ?? base.readFile(resolved)`,
    replace: `files.get(resolved) ?? base.readFile(resolved)`,
    breaks: "Overlay.readFile still returns a file deleted in the overlay",
    test: "test/Workspace/WorkspaceService.test.ts",
  },
  {
    id: "diagnostics-message",
    file: "src/Migration/Diagnostics.ts",
    find: `left.code === right.code && left.message === right.message`,
    replace: `left.code === right.code && true`,
    breaks: "diagnostics that differ only by message are treated as the same",
    test: "test/Migration/Verify.test.ts",
  },
  {
    id: "apply-path-escape",
    file: "src/Migration/Apply.ts",
    find: `const relative = path.relative(realWorkspace, realAnchor)`,
    replace: `const relative = ""`,
    breaks: "Apply writes to a path that escapes the workspace",
    test: "test/Migration/Apply.test.ts",
  },
  {
    id: "apply-stale-file",
    file: "src/Migration/Apply.ts",
    find: `Sha256.digest(bytes) !== Sha256.digest(expected.bytes)`,
    replace: `Sha256.digest(bytes) === Sha256.digest(expected.bytes)`,
    breaks: "Apply writes over a file that changed after verification",
    test: "test/Migration/Apply.test.ts",
  },
]

const usage = "usage: node scripts/mutation-check.ts [--list | --only <mutant id>]"

class MutationCheckFailed extends Data.TaggedError("MutationCheckFailed")<{
  readonly message: string
}> {
  readonly [Runtime.errorExitCode] = 1
  readonly [Runtime.errorReported] = false
}

const marker = (mutant: Mutant) => `// mutant: ${mutant.id}`

type Placement = { readonly mutated: string } | { readonly problem: string }

/** Apply `mutant` to the line under its marker in `original`, or say why it cannot be placed. */
const place = (mutant: Mutant, original: string): Placement => {
  const lines = original.split("\n")
  const marked = lines.flatMap((line, index) => line.trim() === marker(mutant) ? [index] : [])
  const problem = (found: string): Placement => ({
    problem: [
      `mutant ${mutant.id}`,
      `  file: ${mutant.file}`,
      `  expected marker: ${marker(mutant)} (once, on the line above the code to mutate)`,
      found,
      `  find: ${mutant.find}`,
    ].join("\n"),
  })
  const [markerIndex] = marked
  if (marked.length !== 1 || markerIndex === undefined) {
    return problem(`  markers found: ${marked.length}`)
  }
  const target = lines[markerIndex + 1] ?? ""
  const matches = target.split(mutant.find).length - 1
  if (matches !== 1) {
    return problem(`  markers found: 1\n  find matches on the marked line: ${matches}`)
  }
  lines[markerIndex + 1] = target.replace(mutant.find, () => mutant.replace)
  return { mutated: lines.join("\n") }
}

const selectMutants = (args: ReadonlyArray<string>) => {
  if (args.length === 0) return Effect.succeed(mutants)
  const [flag, id] = args
  if (flag === "--only" && id !== undefined && args.length === 2) {
    const chosen = mutants.find((mutant) => mutant.id === id)
    return chosen === undefined ?
      Effect.fail(
        new MutationCheckFailed({
          message: `unknown mutant "${id}"; run with --list to see ids`,
        }),
      ) :
      Effect.succeed([chosen])
  }
  return Effect.fail(new MutationCheckFailed({ message: usage }))
}

const excludedFromCopy = new Set(["node_modules", ".git", "coverage", "dist"])

const program = Effect.gen(function* () {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--list") {
    const width = Math.max(...mutants.map((mutant) => mutant.id.length))
    for (const mutant of mutants) {
      yield* Console.log(`${mutant.id.padEnd(width)}  ${mutant.test}  (${mutant.file})`)
    }
    return
  }
  const selected = yield* selectMutants(args)

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* path.fromFileUrl(new URL("..", import.meta.url))

  // Validate every marker before running anything, so a drifted anchor fails in
  // milliseconds instead of after a baseline test run.
  const placements = yield* Effect.forEach(
    mutants,
    (mutant) =>
      fs.readFileString(path.resolve(root, mutant.file)).pipe(
        Effect.map((original) => ({ mutant, original, placement: place(mutant, original) })),
      ),
  )
  const problems = placements.flatMap(({ placement }) =>
    "problem" in placement ? [placement.problem] : []
  )
  if (problems.length > 0) {
    return yield* new MutationCheckFailed({
      message: [
        `${problems.length} of ${mutants.length} mutants cannot be placed. Fix the marker comment in src/ or the mutant's find text in scripts/mutation-check.ts:`,
        ...problems,
      ].join("\n\n"),
    })
  }
  const runnable = placements.flatMap(({ mutant, original, placement }) =>
    "mutated" in placement && selected.includes(mutant) ?
      [{ mutant, original, mutated: placement.mutated }] :
      []
  )

  yield* Effect.scoped(Effect.gen(function* () {
    const copy = yield* fs.makeTempDirectoryScoped({ prefix: "safemods-mutation-" })
    for (const name of yield* fs.readDirectory(root)) {
      if (!excludedFromCopy.has(name)) {
        yield* fs.copy(path.join(root, name), path.join(copy, name))
      }
    }
    yield* fs.symlink(path.join(root, "node_modules"), path.join(copy, "node_modules"))

    const vitest = path.join(copy, "node_modules", "vitest", "vitest.mjs")
    const runTest = (test: string) => runCommand(process.execPath, [vitest, "run", test], copy)

    const runMutant = (mutant: Mutant, original: string, mutated: string) => {
      const file = path.join(copy, mutant.file)
      return fs.writeFileString(file, mutated).pipe(
        Effect.andThen(runTest(mutant.test)),
        Effect.ensuring(fs.writeFileString(file, original).pipe(Effect.orDie)),
      )
    }

    // A test that fails on its own would make every mutant on it look killed, so
    // prove each one passes once before trusting a failure to mean the mutant died.
    const tests = Array.from(new Set(selected.map((mutant) => mutant.test)))
    yield* Effect.forEach(
      tests,
      (test) =>
        runTest(test).pipe(
          Effect.flatMap(({ exitCode, stdout, stderr }) =>
            exitCode === 0 ?
              Effect.void :
              Effect.fail(
                new MutationCheckFailed({
                  message:
                    `${test} fails without any mutant applied, so mutation results would be meaningless; fix it first (pnpm exec vitest run ${test}):\n${stdout}\n${stderr}`,
                }),
              )
          ),
        ),
      { concurrency: 1, discard: true },
    )

    const outcomes = yield* Effect.forEach(
      runnable,
      ({ mutant, original, mutated }) =>
        runMutant(mutant, original, mutated).pipe(
          Effect.map(({ exitCode }) => ({ mutant, killed: exitCode !== 0 })),
          Effect.tap(({ killed }) =>
            Console.log(killed ? `killed    ${mutant.id}` : `survived  ${mutant.id}`)
          ),
        ),
      { concurrency: 1 },
    )

    const survivors = outcomes.filter((outcome) => !outcome.killed).map((outcome) => outcome.mutant)
    if (survivors.length > 0) {
      return yield* new MutationCheckFailed({
        message: [
          `${survivors.length} of ${selected.length} mutants survived; the suite does not detect them:`,
          ...survivors.map((survivor) =>
            `  mutant ${survivor.id} survived: ${survivor.test} does not fail when ${survivor.breaks}; add an assertion that observes it (code: ${survivor.file}, marker: ${
              marker(survivor)
            })`
          ),
        ].join("\n"),
      })
    }
    yield* Console.log(`\nAll ${selected.length} mutants killed.`)
  }))
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
