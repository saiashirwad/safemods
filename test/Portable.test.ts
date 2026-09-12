import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"

describe("portable project paths", () => {
  effect("normalizes portable relative paths", () =>
    Effect.gen(function* () {
      expect(yield* ProjectRelativePath.make("./src\\feature/../index.ts")).toBe("src/index.ts")
      expect(yield* ProjectRelativePath.make("src//index.ts")).toBe("src/index.ts")
      expect(yield* ProjectRelativePath.make("src/../src/index.ts")).toBe("src/index.ts")
    }),
  )

  effect.each([
    "",
    ".",
    "..",
    "../index.ts",
    "/src/index.ts",
    "\\server\\share\\index.ts",
    "//server/share/index.ts",
    "C:\\src\\index.ts",
    "C:/src/index.ts",
    "src/device:name.ts",
    "src/\0index.ts",
  ])("rejects nonportable path %j", (path) =>
    Effect.gen(function* () {
      const failure = yield* ProjectRelativePath.make(path).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(ProjectRelativePath.InvalidProjectRelativePath)
      expect(failure.path).toBe(path)
    }),
  )
})
