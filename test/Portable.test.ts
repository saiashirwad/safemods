import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import * as ProjectRelativePath from "../src/ProjectRelativePath.ts"

const decode = Schema.decodeUnknownOption(ProjectRelativePath.schema)

describe("portable project paths", () => {
  it.each([
    ["./src\\feature/../index.ts", "src/index.ts"],
    ["src//index.ts", "src/index.ts"],
    ["src/../src/index.ts", "src/index.ts"],
  ])("normalizes %j", (input, expected) => {
    expect(Option.getOrUndefined(decode(input))).toBe(expected)
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
    expect(Option.isNone(decode(path))).toBe(true)
  })
})
