import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, "..")
const fixture = await mkdtemp(join(tmpdir(), "safemods-package-smoke-"))

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const pack = await exec("pnpm", ["pack", "--pack-destination", fixture], { cwd: root })
  const tarballPath = pack.stdout.trim().split("\n").at(-1)
  if (tarballPath === undefined || !tarballPath.endsWith(".tgz")) {
    throw new Error(`Could not determine packed tarball from pnpm output: ${pack.stdout}`)
  }
  const tarballName = basename(tarballPath)

  const imports = Object.keys(packageJson.exports)
    .map((subpath, index) => {
      const specifier = `${packageJson.name}/${subpath.slice(2)}`
      return `import * as entry${index} from ${JSON.stringify(specifier)}\nvoid entry${index}`
    })
    .join("\n")

  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          [packageJson.name]: `file:./${tarballName}`,
          effect: packageJson.dependencies.effect,
          typescript: packageJson.dependencies.typescript,
        },
        devDependencies: {
          "@types/node": packageJson.devDependencies["@types/node"],
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(fixture, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2024",
          lib: ["ESNext", "DOM", "DOM.Iterable"],
          types: ["node"],
          skipLibCheck: false,
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(fixture, "smoke.ts"),
    `${imports}
import { of as preview, type FilePreview, type FileState, type PlanPreview } from "safemods/Verification"
void preview
declare const previewValue: PlanPreview
declare const fileValue: FilePreview
declare const stateValue: FileState
void previewValue
void fileValue
void stateValue
`,
  )
  await writeFile(
    join(fixture, "compatibility-smoke.mjs"),
    `
import * as ApplicationEntry from "safemods/Application"
import * as DraftEntry from "safemods/Draft"
import * as OverlayEntry from "safemods/Overlay"
import * as PolicyEntry from "safemods/Policy"
import * as QueryEntry from "safemods/Query"
import * as RecipeEntry from "safemods/Recipe"
import * as VerificationEntry from "safemods/Verification"

const forbidden = [
  [ApplicationEntry, "Application"],
  [DraftEntry, "Draft"],
  [DraftEntry, "arguments"],
  [OverlayEntry, "overlay"],
  [OverlayEntry, "computeOverlayMap"],
  [PolicyEntry, "Policy"],
  [QueryEntry, "Query"],
  [QueryEntry, "preceding"],
  [QueryEntry, "following"],
  [QueryEntry, "inside"],
  [QueryEntry, "has"],
  [QueryEntry, "precedes"],
  [QueryEntry, "follows"],
  [RecipeEntry, "Recipe"],
  [VerificationEntry, "Preview"],
  [VerificationEntry, "Verification"],
]

for (const [domain, name] of forbidden) {
  if (name in domain) throw new Error(\`Legacy export still present: \${name}\`)
}

if (
  typeof QueryEntry.Criterion?.inside !== "function" ||
  typeof QueryEntry.Criterion?.has !== "function" ||
  typeof QueryEntry.Criterion?.precedes !== "function" ||
  typeof QueryEntry.Criterion?.follows !== "function"
) {
  throw new Error("Query Criterion does not export the canonical relations")
}

if (typeof VerificationEntry.of !== "function") {
  throw new Error("Verification entry point does not export of")
}

const removedEntryPoints = [
  "safemods",
  "safemods/Cli",
  "safemods/Edit",
  "safemods/Evidence",
  "safemods/Plan",
  "safemods/ProjectPath",
  "safemods/VirtualFs",
]

for (const specifier of removedEntryPoints) {
  try {
    await import(specifier)
  } catch (error) {
    if (error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") continue
    throw error
  }
  throw new Error(\`Removed entry point is still importable: \${specifier}\`)
}
`,
  )

  await exec("pnpm", ["install", "--ignore-scripts", "--frozen-lockfile=false"], { cwd: fixture })
  await exec("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { cwd: fixture })
  await exec("node", ["compatibility-smoke.mjs"], { cwd: fixture })
} finally {
  await rm(fixture, { recursive: true, force: true })
}
