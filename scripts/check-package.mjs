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

const publicExports = {
  "./Application": ["ApplicationFailure", "applyVerifiedPlan"],
  "./Check": ["CheckError", "define", "each", "format", "perProject", "report", "reportAt", "run"],
  "./Checks": [
    "anyInPublicApi",
    "duplicatedFunctions",
    "ignoredReturns",
    "importCycles",
    "layers",
    "oversized",
    "restrictedReferences",
    "suppressions",
    "typeBoundaries",
    "unjustifiedCasts",
    "unusedCode",
    "unusedOptionalParameters",
    "weakReturns",
  ],
  "./Config": ["InvalidConfig", "importModule", "load"],
  "./Draft": [
    "concat",
    "createFile",
    "deleteFile",
    "empty",
    "insertAfter",
    "insertBefore",
    "moveFile",
    "remove",
    "replace",
    "replaceEach",
    "replaceRange",
    "replaceSelection",
    "replaceStringLiteral",
    "replaceText",
    "unsupported",
  ],
  "./Finding": ["locate"],
  "./ModuleSpecifier": ["between", "emitted", "fileNamedBy", "parse"],
  "./Pattern": ["bind", "capture", "either", "isNode", "node", "tagged", "unguarded"],
  "./Plan": ["InvalidPlan", "distinct", "targetOf", "validate"],
  "./ProjectId": ["schema"],
  "./WorkspacePath": ["schema"],
  "./Query": [
    "calls",
    "declarationIn",
    "files",
    "filter",
    "identifiers",
    "imports",
    "isWithin",
    "match",
    "moduleReferences",
    "nameOf",
    "namedFunctions",
    "nodes",
    "publicSymbols",
    "referencesTo",
    "resolvedModuleReferences",
    "resolvesTo",
    "resolvesToSignature",
    "selectionOf",
    "semanticReferences",
    "shape",
    "typeAssignableTo",
    "typed",
    "typedCaptures",
    "usesOf",
    "where",
    "within",
  ],
  "./Recipe": ["RecipeInputError", "checkInput", "define"],
  "./Type": ["effect", "isAny", "isUnknown", "layer", "mentions", "ofSymbol", "stream", "variance"],
  "./Verification": ["StalePlanError", "VerificationFailure", "actionOf", "verify"],
  "./Workspace": [
    "ConfiguredProject",
    "ProjectNotInSnapshot",
    "SnapshotExpired",
    "SymbolNotFound",
    "Workspace",
    "WorkspaceCompilerError",
    "WorkspaceDefinition",
    "WorkspaceSnapshot",
    "layer",
  ],
}

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporary], { cwd: root, stdio: "pipe" })
  const archive = readdirSync(temporary).find((name) => name.endsWith(".tgz"))
  assert.ok(archive, "pnpm pack did not produce a tarball")
  mkdirSync(join(consumer, "src"), { recursive: true })
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { safemods: `file:../${archive}` },
    }),
  )
  execFileSync("pnpm", ["install", "--ignore-scripts"], {
    cwd: consumer,
    stdio: "pipe",
  })

  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  assert.deepEqual(Object.keys(manifest.exports).sort(), Object.keys(publicExports).sort())
  for (const [name, entry] of Object.entries(manifest.exports)) {
    for (const field of ["default", "types"]) {
      assert.ok(existsSync(join(packageRoot, entry[field])), `${name} is missing ${field}`)
    }
    const namespace = await import(pathToFileURL(join(packageRoot, entry.default)).href)
    assert.deepEqual(
      Object.keys(namespace).sort(),
      publicExports[name].toSorted(),
      `${name} exports`,
    )
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
    Object.entries(publicExports).flatMap(([name, exports], index) => [
      `import * as entry${index} from "safemods${name.slice(1)}"`,
      ...exports.map((symbol) => `void entry${index}.${symbol}`),
    ]).join("\n"),
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
    } entry points and named exports import, check exits 1 then 0, declarations typecheck`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
