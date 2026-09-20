import * as Path from "node:path"
import { Context, Effect } from "effect"
import * as FileRef from "./FileRef.ts"
import * as ProjectRelativePath from "./ProjectRelativePath.ts"
import * as Query from "./Query.ts"
import { type ProjectFile, Workspace, WorkspaceSnapshot } from "./Workspace/index.ts"

export class Comparison extends Context.Service<
  Comparison,
  {
    readonly previous: FileRef.ReadonlyMap<ProjectFile>
  }
>()("safemods/Comparison") {}

export const previousMarker = ".__before__"

const scriptExtension = /\.[cm]?[jt]sx?$/

const siblingOf = (name: string): string => {
  const extension = Path.extname(name)
  return `${name.slice(0, name.length - extension.length)}${previousMarker}${extension}`
}

const currentOf = (sibling: ProjectRelativePath.Type): ProjectRelativePath.Type | undefined => {
  const at = sibling.lastIndexOf(previousMarker)
  return ProjectRelativePath.decodeWorkspaceFile(
    `${sibling.slice(0, at)}${sibling.slice(at + previousMarker.length)}`,
  )
}

const previousTargetOf = (
  siblings: ReadonlyMap<string, string>,
  { specifier, resolved }: Query.ResolvedModuleReference,
): string | undefined => {
  const current = resolved === undefined ? undefined : siblingOf(resolved.sourceFile.fileName)
  if (current !== undefined && siblings.has(current)) return current
  if (!specifier.text.startsWith(".")) return undefined
  const stem = Path.resolve(
    Path.dirname(specifier.getSourceFile().fileName),
    specifier.text.replace(scriptExtension, ""),
  )
  return [stem, Path.join(stem, "index")]
    .flatMap((name) =>
      [".ts", ".tsx", ".mts", ".cts"].map((ext) => `${name}${previousMarker}${ext}`),
    )
    .find((name) => siblings.has(name))
}

const specifierTo = (specifier: string, from: string, target: string): string => {
  const extension =
    (specifier.startsWith(".") ? scriptExtension.exec(specifier)?.[0] : Path.extname(target)) ??
    (Path.extname(specifier) === "" ? "" : Path.extname(target))
  const relative = Path.relative(Path.dirname(from), target)
  const stem = relative.slice(0, relative.length - Path.extname(relative).length)
  const name = `${stem}${extension}`.replaceAll(Path.sep, "/")
  return name.startsWith(".") ? name : `./${name}`
}

const rewritten = (siblings: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const snapshot = yield* WorkspaceSnapshot
    const hidden = yield* Effect.forEach(snapshot.projects, (project) => project.hiddenFiles)
    const files = new Map(hidden.flat().map((file) => [file.sourceFile.fileName, file]))
    return new Map(
      yield* Effect.forEach(
        files,
        ([name, file]) =>
          Effect.map(Query.resolvedModuleReferences([file]).pipe(Query.collect), (references) => {
            const text = references.reduceRight((text, { value }) => {
              const target = previousTargetOf(siblings, value)
              if (target === undefined) return text
              const start = value.specifier.getStart(file.sourceFile) + 1
              const end = value.specifier.getEnd() - 1
              const rewrite = specifierTo(value.specifier.text, name, target)
              return `${text.slice(0, start)}${rewrite}${text.slice(end)}`
            }, file.sourceFile.text)
            return [name, text] as const
          }),
        { concurrency: "unbounded" },
      ),
    )
  })

const comparison = Effect.gen(function* () {
  const snapshot = yield* WorkspaceSnapshot
  const previous: FileRef.Map<ProjectFile> = new Map()
  for (const project of snapshot.projects) {
    for (const file of yield* project.hiddenFiles) {
      const fileName = currentOf(file.fileName)
      if (fileName !== undefined)
        FileRef.set(previous, { projectId: project.project.id, fileName }, file)
    }
  }
  return Comparison.of({ previous })
})

export const withComparison = <A, E, R>(
  previous: ReadonlyMap<string, string>,
  program: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const compared = Effect.provideServiceEffect(program, Comparison, comparison)
    if (previous.size === 0) return yield* workspace.withSnapshot(compared)
    const siblings = new Map(
      [...previous].map(([name, text]) => [siblingOf(Path.resolve(name)), text]),
    )
    const overlayOf = (files: ReadonlyMap<string, string>) => ({
      files,
      deleted: new Set<string>(),
      hidden: new Set(files.keys()),
      rootSiblings: new Map(
        [...previous.keys()].map((name) => [Path.resolve(name), siblingOf(Path.resolve(name))]),
      ),
    })
    let texts: ReadonlyMap<string, string> = new Map()
    let growing = true
    while (growing) {
      const reached = yield* workspace.withSnapshot(
        rewritten(siblings),
        overlayOf(new Map([...siblings, ...texts])),
      )
      growing = reached.size > texts.size && reached.size !== siblings.size
      texts = reached
    }
    return yield* workspace.withSnapshot(compared, overlayOf(new Map([...siblings, ...texts])))
  })
