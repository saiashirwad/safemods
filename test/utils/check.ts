import { Effect } from "effect"
import * as Check from "../../src/Check.ts"
import { withFixture } from "./fixture.ts"

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2024",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src/**/*.ts"],
})

export const findingsOf = <E>(
  check: Check.Check<E>,
  files: Record<string, string>,
  options: { readonly dependencies?: boolean } = {},
) =>
  withFixture(() => Check.run([check]), {
    fixture: "empty",
    files: { "tsconfig.json": TSCONFIG, ...files },
    ...options,
  }).pipe(Effect.map((findings) => findings.map(Check.format)))
