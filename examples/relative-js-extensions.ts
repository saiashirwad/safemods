/**
 * Rewrite relative module specifiers to the form NodeNext resolves. A specifier without a
 * runtime extension is matched against the project's own files, so `./auth` becomes
 * `./auth/index.js` when that is the file it names. Specifiers that name no project file are
 * reported rather than guessed at.
 */
import { dirname, normalize } from "node:path/posix"
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { WorkspaceSnapshot } from "safemods/Workspace"

const runtimeExtension = { ".ts": ".js", ".tsx": ".js", ".mts": ".mjs", ".cts": ".cjs" } as const

const candidates = [
  [".ts", ".js"],
  [".tsx", ".js"],
  [".mts", ".mjs"],
  [".cts", ".cjs"],
  ["/index.ts", "/index.js"],
  ["/index.tsx", "/index.js"],
] as const

const rewritable = new Set<Query.ModuleReferenceKind>([
  "import",
  "export",
  "dynamic-import",
  "import-type",
])

const needsRewrite = (specifier: string): boolean =>
  /^\.\.?\//.test(specifier) && !/\.(?:[cm]?js|json|d\.[cm]?ts)$/.test(specifier)

const nodeNextSpecifier = (
  specifier: string,
  fromFile: string,
  projectFiles: ReadonlySet<string>,
): string | undefined => {
  const written = /\.[cm]?tsx?$/.exec(specifier)?.[0] as keyof typeof runtimeExtension | undefined
  if (written !== undefined) {
    return `${specifier.slice(0, -written.length)}${runtimeExtension[written]}`
  }
  const target = normalize(`${dirname(fromFile)}/${specifier}`)
  const match = candidates.find(([suffix]) => projectFiles.has(`${target}${suffix}`))
  return match === undefined ? undefined : `${specifier.replace(/\/$/, "")}${match[1]}`
}

export const relativeJsExtensions = Recipe.define("relative-js-extensions", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: () =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const drafts = yield* Effect.forEach(snapshot.projects, (project) =>
        Effect.gen(function* () {
          const projectFiles = new Set<string>((yield* project.files).map((file) => file.fileName))
          const references = yield* Query.moduleReferences(project).pipe(
            Query.filter(
              ({ value }) => rewritable.has(value.kind) && needsRewrite(value.specifier.text),
            ),
            Query.collect,
          )
          return Draft.concat(
            ...references.map((selection) => {
              const { specifier } = selection.value
              const next = nodeNextSpecifier(specifier.text, selection.fileName, projectFiles)
              if (next === undefined) {
                return Draft.unsupported(selection, `${specifier.text} names no project file`)
              }
              const quote = specifier.getText().startsWith("'") ? "'" : '"'
              return Draft.replace(project, specifier, `${quote}${next}${quote}`)
            }),
          )
        }),
      )
      return Draft.concat(...drafts)
    }),
})
