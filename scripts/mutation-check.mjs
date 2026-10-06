/**
 * Mutation smoke check: prove the suite fails when core behavior changes.
 *
 * Each mutant flips one behavior in `src/`. The named test file must fail while
 * the mutant is in place. A test that still passes means it does not observe the
 * behavior, so the mutant "survives" and this script exits non-zero.
 *
 * The working tree is restored after every mutant and on interruption.
 */
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url))

const mutants = [
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

let active = undefined
const restore = () => {
  if (active !== undefined) {
    writeFileSync(active.path, active.original)
    active = undefined
  }
}
process.on("exit", restore)
const interrupted = (code) => () => {
  restore()
  process.exit(code)
}
process.on("SIGINT", interrupted(130))
process.on("SIGTERM", interrupted(143))

const runTest = (test) =>
  spawnSync(process.execPath, [vitest, "run", test], { cwd: root, encoding: "utf8" })

const verified = new Set()
const survivors = []
for (const mutant of mutants) {
  // A test that fails on its own would make every mutant on it look killed, so
  // prove it passes once before trusting a failure to mean the mutant died.
  if (!verified.has(mutant.test)) {
    const baseline = runTest(mutant.test)
    assert.equal(
      baseline.status,
      0,
      `${mutant.test} fails without a mutant:\n${baseline.stdout}\n${baseline.stderr}`,
    )
    verified.add(mutant.test)
  }

  const path = resolve(root, mutant.file)
  const original = readFileSync(path, "utf8")
  const anchors = original.split(mutant.find).length - 1
  assert.equal(anchors, 1, `${mutant.file}: mutation anchor must appear exactly once`)

  active = { path, original }
  try {
    writeFileSync(path, original.replace(mutant.find, mutant.replace))
    const run = runTest(mutant.test)
    if (run.status === null) {
      throw new Error(`${mutant.name}: vitest did not exit (${run.error?.message ?? "unknown"})`)
    }
    if (run.status === 0) {
      survivors.push(mutant)
      console.log(`survived  ${mutant.name}  (${mutant.test})`)
    } else {
      console.log(`killed    ${mutant.name}`)
    }
  } finally {
    restore()
  }
}

if (survivors.length > 0) {
  console.error(
    `\n${survivors.length} of ${mutants.length} mutants survived; the suite does not detect them:`,
  )
  for (const survivor of survivors) console.error(`  ${survivor.file}: ${survivor.name}`)
  process.exit(1)
}
console.log(`\nAll ${mutants.length} mutants killed.`)
