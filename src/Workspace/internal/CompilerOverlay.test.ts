import { path as Path } from "../../platform/node.ts"
import { describe, expect, it } from "vitest"
import type { WorkspaceRuntimeService } from "../Runtime.ts"
import { compilerOverlayFor } from "./CompilerOverlay.ts"

const runtime = {
  ...Path,
  readFileText: () => undefined,
  fileExists: () => undefined,
  directoryExists: () => undefined,
  directoryEntries: () => undefined,
  realPath: () => undefined,
} satisfies WorkspaceRuntimeService

describe("compiler overlay paths", () => {
  it("matches normalized absolute paths without matching unrelated suffixes", () => {
    const planned = Path.resolve("/workspace/src/util.ts")
    const unrelated = Path.resolve("/workspace/node_modules/pkg/src/util.ts")
    const overlay = compilerOverlayFor(
      runtime,
      {
        fs: {
          readFile: (fileName) => `disk:${fileName}`,
          fileExists: () => false,
        },
      },
      {
        files: new Map([[planned, "changed"]]),
        created: new Set(),
        deleted: new Set(),
      },
    )

    expect(overlay.options.fs?.readFile?.("/workspace/src/./util.ts")).toBe("changed")
    expect(overlay.options.fs?.readFile?.(unrelated)).toBe(`disk:${unrelated}`)
    expect(overlay.options.fs?.fileExists?.("/workspace/src/./util.ts")).toBe(true)
    expect(overlay.options.fs?.fileExists?.(unrelated)).toBe(false)
  })
})
