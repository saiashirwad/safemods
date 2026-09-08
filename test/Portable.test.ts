import { describe, expect, it } from "vitest"
import { parseProjectRelativePath } from "../src/ProjectPath.ts"

describe("portable project paths", () => {
  it("normalizes portable relative paths", () => {
    expect(parseProjectRelativePath("./src\\feature/../index.ts")).toBe("src/index.ts")
    expect(parseProjectRelativePath("src//index.ts")).toBe("src/index.ts")
    expect(parseProjectRelativePath("src/../src/index.ts")).toBe("src/index.ts")
  })

  it.each([
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
  ])("rejects nonportable path %j", (path) => {
    expect(parseProjectRelativePath(path)).toBeUndefined()
  })
})
