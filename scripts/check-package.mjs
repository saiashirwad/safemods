import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = mkdtempSync(join(root, ".package-check-"))
const packageRoot = join(temporary, "node_modules", "safemods")
const consumer = join(temporary, "consumer")

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporary], { cwd: root, stdio: "pipe" })
  const archive = readdirSync(temporary).find((name) => name.endsWith(".tgz"))
  assert.ok(archive, "pnpm pack did not produce a tarball")
  mkdirSync(packageRoot, { recursive: true })
  execFileSync("tar", ["-xzf", join(temporary, archive), "--strip-components=1", "-C", packageRoot])

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  for (const [name, entry] of Object.entries(manifest.exports)) {
    for (const field of ["default", "types"]) {
      assert.ok(existsSync(join(packageRoot, entry[field])), `${name} is missing ${field}`)
    }
    const namespace = await import(pathToFileURL(join(packageRoot, entry.default)).href)
    assert.ok(Object.keys(namespace).length > 0, `${name} has no runtime exports`)
  }

  mkdirSync(join(consumer, "src"), { recursive: true })
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
  writeFileSync(join(consumer, "package.json"), '{"type":"module"}')
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
  const findings = JSON.parse(rejected.stdout)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].fileName, "src/example.ts")
  assert.equal(findings[0].check, "suppressions")
  assert.match(findings[0].message, /@ts-ignore/)
  writeFileSync(source, "export const value = 1\n")
  const accepted = check()
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`)
  assert.deepEqual(JSON.parse(accepted.stdout), [])

  const types = spawnSync(join(root, "node_modules", ".bin", "tsc"), [
    "--noEmit",
    "-p",
    join(consumer, "tsconfig.json"),
  ], { encoding: "utf8" })
  assert.equal(types.status, 0, `${types.stdout}\n${types.stderr}`)
  console.log(
    `Packed consumer: ${
      Object.keys(manifest.exports).length
    } exports import, check exits 1 then 0, declarations typecheck`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
