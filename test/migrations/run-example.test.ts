import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { runExample } from "../../examples/run.ts"

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/migrations/rename-package-import/", import.meta.url),
)

describe("example runner", () => {
  effect(
    "applies to a copy and leaves the fixture bytes unchanged",
    () =>
      Effect.gen(function* () {
        const relative = "src/http/gateway.ts"
        const original = yield* Effect.tryPromise(() =>
          Fs.readFile(Path.join(fixtureRoot, relative), "utf8"),
        )
        expect(original).toContain("@acme/legacy-client")

        const result = yield* runExample("rename-package-import")
        expect(result.applied).toBe(true)
        expect(result.workspace).not.toBe(Path.resolve(fixtureRoot))
        expect(result.workspace.startsWith(Path.resolve(fixtureRoot))).toBe(false)

        expect(
          yield* Effect.tryPromise(() => Fs.readFile(Path.join(fixtureRoot, relative), "utf8")),
        ).toBe(original)

        const rewritten = yield* Effect.tryPromise(() =>
          Fs.readFile(Path.join(result.workspace, relative), "utf8"),
        )
        expect(rewritten).toContain("@acme/client")
        expect(rewritten).not.toContain("@acme/legacy-client")
        expect(result.diff).toContain("@acme/legacy-client")
        expect(result.diff).toContain("@acme/client")

        yield* Effect.tryPromise(() => Fs.rm(result.workspace, { recursive: true, force: true }))
      }),
    60_000,
  )
})
