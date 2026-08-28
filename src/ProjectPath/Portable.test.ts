import { path as Path } from "../platform/node.ts"
import { describe, expect, it } from "vitest"
import {
  InvalidProjectRelativePath,
  isPathContained,
  isProjectRelativePath,
  parseProjectRelativePath,
  requireProjectRelativePath,
  resolveContainedProjectPath,
} from "./index.ts"

describe("portable project paths", () => {
  it("normalizes portable relative paths", () => {
    expect(parseProjectRelativePath("./src\\feature/../index.ts")).toBe("src/index.ts")
    expect(parseProjectRelativePath("src//index.ts")).toBe("src/index.ts")
    expect(isProjectRelativePath("src/index.ts")).toBe(true)
    expect(isProjectRelativePath("./src/index.ts")).toBe(false)
  })

  it.each([
    "",
    ".",
    "..",
    "../index.ts",
    "/src/index.ts",
    "\\server\\share\\index.ts",
    "C:\\src\\index.ts",
    "src/device:name.ts",
    "src/\0index.ts",
  ])("rejects nonportable path %j", (path) => {
    expect(parseProjectRelativePath(path)).toBeUndefined()
  })

  it("reports the rejected input", () => {
    expect(() => requireProjectRelativePath("../index.ts")).toThrow(
      new InvalidProjectRelativePath({ path: "../index.ts" }),
    )
  })
})

describe("host path containment", () => {
  const root = Path.resolve("/tmp/SafeModsCase/Project")
  const caseVariant = Path.resolve("/tmp/safemodscase/project/src/index.ts")

  it("preserves case unless the caller opts into case-insensitive comparison", () => {
    expect(isPathContained(Path, root, caseVariant)).toBe(false)
    expect(isPathContained(Path, root, caseVariant, { caseInsensitive: true })).toBe(true)
    expect(resolveContainedProjectPath(Path, root, caseVariant, { caseInsensitive: true })).toBe(
      caseVariant,
    )
  })

  it("still rejects siblings and escapes during case-insensitive comparison", () => {
    expect(
      isPathContained(Path, root, Path.resolve("/tmp/SafeModsCase/Other/index.ts"), {
        caseInsensitive: true,
      }),
    ).toBe(false)
    expect(
      isPathContained(Path, root, Path.resolve(root, "../outside.ts"), {
        caseInsensitive: true,
      }),
    ).toBe(false)
  })
})
