import { Effect } from "effect"
import { isNonNullExpression } from "typescript/unstable/ast/is"
import * as Check from "../Check.ts"
import * as Query from "../Query.ts"
import { filesWithin } from "./Exported.ts"

const directive = /@ts-ignore|@ts-expect-error|@ts-nocheck|(?:eslint|oxlint)-disable/g

export const suppressions = (options: { readonly within: string }) =>
  Check.perProject("suppressions", (project) =>
    Effect.gen(function* () {
      const files = yield* filesWithin(project, [options.within])
      const asserted = yield* Query.nodes(project, isNonNullExpression).pipe(
        Query.within(options.within),
        Query.collect,
      )
      return [
        ...files.flatMap((file) =>
          [...file.sourceFile.text.matchAll(directive)].map((match) => ({
            projectId: project.project.id,
            fileName: file.fileName,
            start: match.index,
            message: `${match[0]} silences the compiler: fix the type it complains about`,
          })),
        ),
        ...asserted.map((selection) =>
          Check.report(
            selection,
            `${selection.value.getText().replace(/\s+/g, " ").slice(0, 40)} asserts non-null on trust: handle the undefined case`,
          ),
        ),
      ]
    }),
  )
