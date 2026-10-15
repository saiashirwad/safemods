import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "@effect/vitest"
import { exampleIds } from "../examples/run.ts"

// Files in examples/ that are not fixture-backed migrations: run.ts is the runner,
// no-unknown-failures is a check, and rename-symbol is a CLI recipe tested in test/bin.test.ts.
const notMigrations: Record<string, true> = {
  "run": true,
  "no-unknown-failures": true,
  "rename-symbol": true,
}

const namesIn = (directory: string, suffix: string): ReadonlyArray<string> =>
  readdirSync(fileURLToPath(new URL(directory, import.meta.url)))
    .filter((name) => !name.startsWith(".") && name.endsWith(suffix))
    .map((name) => name.slice(0, name.length - suffix.length))
    .toSorted()

describe("examples registry", () => {
  const ids = exampleIds.toSorted()

  it("lists every migration recipe in examples/", () => {
    expect(ids).toEqual(namesIn("../examples/", ".ts").filter((name) => !(name in notMigrations)))
  })

  it("has a fixture directory for every example", () => {
    expect(ids).toEqual(namesIn("../fixtures/migrations/", ""))
  })

  it("has a test in test/migrations for every example", () => {
    expect(ids).toEqual(
      namesIn("./migrations/", ".test.ts").filter((name) => name !== "run-example"),
    )
  })
})
