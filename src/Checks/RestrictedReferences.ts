import { Effect } from "effect"
import * as Check from "../Check.ts"
import type * as WorkspacePath from "../WorkspacePath.ts"
import * as Query from "../Query.ts"

export const restrictedReferences = (options: {
  readonly name: string
  readonly declaredIn: WorkspacePath.Type
  readonly allowedWithin: ReadonlyArray<string>
}) =>
  Check.perProject(`restricted-references:${options.name}`, (project) =>
    Effect.gen(function* () {
      const declarations = yield* Query.identifiers(project).pipe(
        Query.within(options.declaredIn),
        Query.filter(({ value }) =>
          value.text === options.name && Query.nameOf(value.parent) === value
        ),
      )
      const references = yield* Effect.forEach(declarations, (declaration) =>
        Query.referencesTo(declaration))
      const outside = new Map(
        references
          .flat()
          .filter(
            ({ fileName }) =>
              !options.allowedWithin.some((pattern) =>
                Query.isWithin(fileName, pattern)
              ),
          )
          .map((reference) => [`${reference.fileName}:${reference.start}`, reference]),
      )
      return [...outside.values()].map((reference) =>
        Check.report(
          reference,
          `${options.name} may only be used within ${options.allowedWithin.join(", ")}`,
        )
      )
    }))
