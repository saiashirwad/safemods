import { Effect } from "effect"
import * as Check from "../../src/Check.ts"
import { withFixture } from "./fixture.ts"

export const findingsOf = <E>(
  check: Check.Definition<E>,
  files: Record<string, string>,
  options: { readonly dependencies?: boolean } = {},
) =>
  withFixture(() => Check.run([check]), { files, ...options }).pipe(
    Effect.map((findings) => findings.map(Check.format)),
  )
