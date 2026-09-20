import { matchesGlob } from "node:path"
import { Effect } from "effect"
import * as Check from "../Check.ts"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import * as Query from "../Query.ts"
import { nameOf } from "./Exported.ts"

export const restrictedReferences = (options: {
  readonly name: string
  readonly declaredIn: ProjectRelativePath.Type
  readonly allowedWithin: ReadonlyArray<string>
}) =>
  Check.perProject(`restricted-references:${options.name}`, (project) =>
    Effect.gen(function* () {
      const declarations = yield* Query.identifiers(project).pipe(
        Query.within(options.declaredIn),
        Query.filter(({ value }) => value.text === options.name && nameOf(value.parent) === value),
        Query.collect,
      )
      const references = yield* Effect.forEach(declarations, (declaration) =>
        Query.collect(Query.referencesTo(declaration)),
      )
      const outside = new Map(
        references
          .flat()
          .filter(
            ({ fileName }) =>
              !options.allowedWithin.some((pattern) => matchesGlob(fileName, pattern)),
          )
          .map((reference) => [`${reference.fileName}:${reference.start}`, reference]),
      )
      return [...outside.values()].map((reference) =>
        Check.report(
          reference,
          `${options.name} may only be used within ${options.allowedWithin.join(", ")}`,
        ),
      )
    }),
  )
