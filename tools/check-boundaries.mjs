import { readdir, readFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"

const TYPESCRIPT_SOURCE = /\.(?:[cm]?ts|tsx)$/
const TYPESCRIPT_TEST = /\.test\.(?:[cm]?ts|tsx)$/

export const architectureLayers = [
  ["Edit", "Evidence", "Plan", "Policy", "ProjectPath", "VirtualFs", "generated"],
  ["Pattern", "Query", "Workspace"],
  ["Draft", "Overlay"],
  ["Application", "Execution", "Recipe", "Verification"],
  ["Node", "platform"],
  ["Cli", "bin"],
]

const layerByOwner = new Map(
  architectureLayers.flatMap((owners, layer) => owners.map((owner) => [owner, layer])),
)

const exactDependencies = new Map([
  ["Pattern", new Set(["Evidence", "Workspace"])],
  ["Query", new Set(["Evidence", "Pattern", "ProjectPath", "Workspace"])],
  ["Workspace", new Set(["Edit", "ProjectPath", "VirtualFs"])],
  [
    "Recipe",
    new Set([
      "Draft",
      "Edit",
      "Evidence",
      "Overlay",
      "Plan",
      "Policy",
      "ProjectPath",
      "VirtualFs",
      "Workspace",
      "generated",
    ]),
  ],
  [
    "Verification",
    new Set([
      "Edit",
      "Evidence",
      "Plan",
      "Policy",
      "ProjectPath",
      "Recipe",
      "VirtualFs",
      "Workspace",
    ]),
  ],
  ["Application", new Set(["Edit", "Plan", "ProjectPath", "Verification", "Workspace"])],
  [
    "Execution",
    new Set([
      "Application",
      "Draft",
      "Evidence",
      "Plan",
      "Policy",
      "Recipe",
      "Verification",
      "Workspace",
    ]),
  ],
  ["bin", new Set(["Cli"])],
])

const files = async (directory) =>
  (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map((entry) =>
        entry.isDirectory()
          ? files(resolve(directory, entry.name))
          : [resolve(directory, entry.name)],
      ),
    )
  ).flat()

const importSpecifiers = (text) => [
  ...text.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g),
  ...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
]

const ownerOf = (repositoryRoot, file) => {
  const sourceRoot = resolve(repositoryRoot, "src")
  const sourceRelative = relative(sourceRoot, file)
  if (!sourceRelative.startsWith(`..${sep}`) && sourceRelative !== "..") {
    return sourceRelative.split(sep)[0]
  }
  const binRoot = resolve(repositoryRoot, "bin")
  const binRelative = relative(binRoot, file)
  if (!binRelative.startsWith(`..${sep}`) && binRelative !== "..") return "bin"
  return undefined
}

const targetDetails = (repositoryRoot, file, specifier) => {
  const target = resolve(dirname(file), specifier)
  const sourceRoot = resolve(repositoryRoot, "src")
  const sourceRelative = relative(sourceRoot, target)
  if (!sourceRelative.startsWith(`..${sep}`) && sourceRelative !== "..") {
    return {
      owner: sourceRelative.split(sep)[0],
      parts: sourceRelative.split(sep),
    }
  }
  const binRoot = resolve(repositoryRoot, "bin")
  const binRelative = relative(binRoot, target)
  if (!binRelative.startsWith(`..${sep}`) && binRelative !== "..") {
    return { owner: "bin", parts: ["bin", ...binRelative.split(sep)] }
  }
  return undefined
}

export const dependencyFailure = (owner, targetOwner) => {
  if (owner === targetOwner) return undefined

  const exact = exactDependencies.get(owner)
  if (exact !== undefined && !exact.has(targetOwner)) {
    return `${owner} must not depend on ${targetOwner}`
  }

  const ownerLayer = layerByOwner.get(owner)
  const targetLayer = layerByOwner.get(targetOwner)
  if (ownerLayer === undefined) return `unclassified source owner ${owner}`
  if (targetLayer === undefined) return `imports unclassified owner ${targetOwner}`
  return targetLayer <= ownerLayer ? undefined : `${owner} imports higher layer ${targetOwner}`
}

export const checkArchitectureBoundaries = async (repositoryRoot) => {
  const failures = []
  const sourceFiles = [
    ...(await files(resolve(repositoryRoot, "src"))),
    ...(await files(resolve(repositoryRoot, "bin"))),
  ]

  for (const file of sourceFiles) {
    if (!TYPESCRIPT_SOURCE.test(file) || TYPESCRIPT_TEST.test(file)) continue
    const owner = ownerOf(repositoryRoot, file)
    if (owner === "test") continue
    const displayFile = relative(repositoryRoot, file)
    if (owner === undefined || !layerByOwner.has(owner)) {
      failures.push(`${displayFile}: unclassified source owner ${owner ?? "outside roots"}`)
      continue
    }

    const text = await readFile(file, "utf8")
    for (const match of importSpecifiers(text)) {
      const specifier = match[1]
      if (specifier === "safemods" || specifier.startsWith("safemods/")) {
        failures.push(`${displayFile}: package self-import ${specifier}`)
      }
      if (!specifier.startsWith(".")) continue
      const target = targetDetails(repositoryRoot, file, specifier)
      if (target === undefined) {
        failures.push(`${displayFile}: relative import escapes architecture roots ${specifier}`)
        continue
      }
      if (target.parts.includes("internal") && target.owner !== owner) {
        failures.push(`${displayFile}: imports private ${specifier}`)
        continue
      }
      const failure = dependencyFailure(owner, target.owner)
      if (failure !== undefined) failures.push(`${displayFile}: ${failure} (${specifier})`)
    }
  }
  return failures
}

const repositoryRoot = resolve(import.meta.dirname, "..")
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename
if (isMain) {
  const failures = await checkArchitectureBoundaries(repositoryRoot)
  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exitCode = 1
  } else {
    console.log("Architecture boundaries passed")
  }
}
