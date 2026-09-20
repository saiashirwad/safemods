import { matchesGlob } from "node:path"
import { Effect } from "effect"
import type { Node } from "typescript/unstable/ast"
import * as Check from "../Check.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import * as Query from "../Query.ts"
import { WorkspaceSnapshot } from "../Workspace/index.ts"

export const restrictedReferences = (options: {
  readonly name: string
  readonly declaredIn: ProjectRelativePath.Type
  readonly allowedWithin: ReadonlyArray<string>
}) =>
  Check.define(
    `restricted-references:${options.name}`,
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const reports = yield* Effect.forEach(snapshot.projects, (project) =>
        Effect.gen(function* () {
          const declarations = yield* Query.identifiers(project).pipe(
            Query.within(options.declaredIn),
            Query.filter(
              ({ value }) =>
                value.text === options.name &&
                (value.parent as Node & { readonly name?: Node }).name === value,
            ),
            Query.collect,
          )
          const references = yield* Effect.forEach(declarations, (declaration) =>
            Query.collect(Query.referencesTo(declaration)),
          )
          const unique = new Map(
            references
              .flat()
              .map((reference) => [`${reference.fileName}:${reference.start}`, reference]),
          )
          return [...unique.values()]
            .filter(
              ({ fileName }) =>
                !options.allowedWithin.some((pattern) => matchesGlob(fileName, pattern)),
            )
            .map((reference) =>
              Check.report(
                reference,
                `${options.name} may only be used within ${options.allowedWithin.join(", ")}`,
              ),
            )
        }),
      )
      return reports.flat()
    }),
  )
