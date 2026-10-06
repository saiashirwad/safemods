import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), "safemods-package-check-"))
const consumer = join(temporary, "consumer")
const packageRoot = join(consumer, "node_modules", "safemods")

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporary], { cwd: root, stdio: "pipe" })
  const archive = readdirSync(temporary).find((name) => name.endsWith(".tgz"))
  assert.ok(archive, "pnpm pack did not produce a tarball")
  mkdirSync(join(consumer, "src"), { recursive: true })
  const { dependencies } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        safemods: `file:../${archive}`,
        effect: dependencies.effect,
        typescript: dependencies.typescript,
      },
    }),
  )
  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: consumer,
    stdio: "pipe",
  })

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  for (const [name, entry] of Object.entries(manifest.exports)) {
    for (const field of ["default", "types"]) {
      assert.ok(existsSync(join(packageRoot, entry[field])), `${name} is missing ${field}`)
    }
    const namespace = await import(pathToFileURL(join(packageRoot, entry.default)).href)
    assert.ok(Object.keys(namespace).length > 0, `${name} imports`)
  }

  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ESNext",
        strict: true,
      },
      include: ["src/**/*.ts", "safemods.config.ts"],
    }),
  )
  writeFileSync(
    join(consumer, "src", "public-api.ts"),
    [
      'import { Effect, Schema } from "effect"',
      'import { isDebuggerStatement } from "typescript/unstable/ast/is"',
      'import { Check, Proposal, Query, Recipe, Migration, Workspace, WorkspacePath } from "safemods"',
      'export const recipe = Recipe.perProject("remove-debugger", {',
      '  version: "1.0.0",',
      "  run: (project) => Effect.gen(function* () {",
      "    const statements = yield* Query.nodes(project, isDebuggerStatement)",
      "    return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))",
      "  }),",
      "})",
      'const input = Recipe.define("encoded-input", {',
      '  version: "1.0.0", schema: Schema.FiniteFromString,',
      '  run: (_snapshot, count) => Effect.succeed(Proposal.createFile(Schema.decodeUnknownSync(WorkspacePath.schema)("created.ts"), `export const count = ${count}`)),',
      "})",
      "export const migrate = Migration.verify(input, 3).pipe(Effect.flatMap((verified) => verified.apply))",
      'export const check = Check.perProject("identifiers", (project) => Query.identifiers(project).pipe(Effect.map((found) => found.map((selection) => Check.report(selection, "identifier")))))',
      "export const program = Workspace.Workspace.use((workspace) => workspace.withSnapshot((snapshot) => recipe.run(snapshot, undefined)))",
    ].join("\n"),
  )
  writeFileSync(
    join(consumer, "safemods.config.ts"),
    [
      'import { suppressions } from "safemods/Checks"',
      'import type * as Config from "safemods/Config"',
      "export default {",
      '  projects: [{ id: "consumer", config: "tsconfig.json" }],',
      '  checks: [suppressions({ within: "src/**" })],',
      "} satisfies Config.Config",
    ].join("\n"),
  )
  const source = join(consumer, "src", "example.ts")
  writeFileSync(source, "// @ts-ignore\nexport const value = 1\n")

  const check = () =>
    spawnSync(process.execPath, [
      join(packageRoot, manifest.bin.safemods),
      "check",
      "--format",
      "json",
    ], {
      cwd: consumer,
      encoding: "utf8",
    })
  const rejected = check()
  assert.equal(rejected.status, 1, `${rejected.stdout}\n${rejected.stderr}`)
  assert.match(rejected.stdout, /^\s*\[/, `${rejected.stdout}\n${rejected.stderr}`)
  const findings = JSON.parse(rejected.stdout)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].fileName, "src/example.ts")
  assert.equal(findings[0].check, "suppressions")
  assert.match(findings[0].message, /@ts-ignore/)
  writeFileSync(source, "export const value = 1\n")
  const accepted = check()
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`)
  assert.match(accepted.stdout, /^\s*\[/, `${accepted.stdout}\n${accepted.stderr}`)
  assert.deepEqual(JSON.parse(accepted.stdout), [])

  writeFileSync(
    join(consumer, "recipe.ts"),
    [
      'import { Effect } from "effect"',
      'import { isDebuggerStatement } from "typescript/unstable/ast/is"',
      'import { Proposal, Query, Recipe } from "safemods"',
      'export default Recipe.perProject("remove-debugger", {',
      '  version: "1.0.0",',
      "  run: (project, input) => Effect.gen(function* () {",
      '    if (input !== undefined) throw new Error("absent input must be undefined")',
      "    const statements = yield* Query.nodes(project, isDebuggerStatement)",
      "    return Proposal.concat(...statements.map(({ value }) => Proposal.remove(project, value)))",
      "  }),",
      "})",
    ].join("\n"),
  )
  writeFileSync(source, "export const value = 1; debugger;\n")
  const runRecipe = (...args) =>
    spawnSync(process.execPath, [
      join(packageRoot, manifest.bin.safemods),
      "run",
      "recipe.ts",
      ...args,
    ], { cwd: consumer, encoding: "utf8" })
  const preview = runRecipe()
  assert.equal(preview.status, 0, `${preview.stdout}\n${preview.stderr}`)
  assert.match(preview.stdout, /-export const value = 1; debugger;/)
  assert.match(preview.stdout, /\+export const value = 1;/)
  assert.match(readFileSync(source, "utf8"), /debugger;/)
  const applied = runRecipe("--apply")
  assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`)
  assert.doesNotMatch(readFileSync(source, "utf8"), /debugger;/)

  const typescript = createRequire(realpathSync(join(packageRoot, "package.json"))).resolve(
    "typescript/package.json",
  )
  const types = spawnSync(process.execPath, [
    join(dirname(typescript), "bin", "tsc"),
    "--noEmit",
    "-p",
    join(consumer, "tsconfig.json"),
  ], { encoding: "utf8" })
  assert.equal(types.status, 0, `${types.stdout}\n${types.stderr}\n${types.error ?? ""}`)
  console.log(
    `Packed consumer: ${
      Object.keys(manifest.exports).length
    } entry points import, consumer recipes typecheck, check exits 1 then 0, run previews then applies, declarations typecheck`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
