import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { withFixture } from "./utils/fixture.ts"

const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url))

const safemods = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.promise(
    () =>
      new Promise<ReadonlyArray<string>>((resolve) =>
        execFile(process.execPath, ["--conditions=source", bin, ...args], { cwd }, (_, stdout) =>
          resolve(stdout.trimEnd().split("\n")))
      ),
  )

describe("inspect commands", () => {
  effect(
    "answer from the compiler: types, references through aliases, direct calls, exports and the module graph",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            expect(yield* safemods(root, "type", "src/lib.ts:1:14")).toEqual([
              "node      area",
              "type      (shape: Shape) => number",
              "declared  src/lib.ts:1:14  export const area = (shape: Shape): number => shape.width * shape.height",
            ])
            expect(yield* safemods(root, "refs", "src/lib.ts:1:14")).toEqual([
              "src/lib.ts:1:14  export const area = (shape: Shape): number => shape.width * shape.height",
              'src/user.ts:1:10  import { area as size, type Shape } from "./lib.js"',
              'src/user.ts:1:18  import { area as size, type Shape } from "./lib.js"',
              "src/user.ts:3:22  export const total = size(unit) + size(unit)",
              "src/user.ts:3:35  export const total = size(unit) + size(unit)",
              "src/user.ts:4:34  export const passed = [unit].map(size)",
            ])
            expect(yield* safemods(root, "calls", "src/lib.ts:1:14")).toEqual([
              "src/user.ts:3:22  export const total = size(unit) + size(unit)",
              "src/user.ts:3:35  export const total = size(unit) + size(unit)",
              "note: also used other than by a direct call, so more callers may exist",
            ])
            expect(yield* safemods(root, "exports", "src/lib.ts")).toEqual([
              "Shape: Shape",
              "area: (shape: Shape) => number",
            ])
            expect(yield* safemods(root, "deps", "src/lib.ts")).toEqual([
              "imported by  src/user.ts",
            ])
            expect(yield* safemods(root, "map")).toEqual([
              "lines  exports  imported-by  imports  file",
              "    3        2            1        0  src/lib.ts",
              "    5        2            0        1  src/user.ts",
            ])
          }),
        {
          fixture: "empty",
          files: {
            "tsconfig.json": JSON.stringify({
              compilerOptions: {
                strict: true,
                module: "NodeNext",
                moduleResolution: "NodeNext",
                noEmit: true,
              },
              include: ["src/**/*.ts"],
            }),
            "safemods.config.ts":
              'export default { projects: [{ id: "app", config: "tsconfig.json" }], checks: [] }\n',
            "src/lib.ts":
              "export const area = (shape: Shape): number => shape.width * shape.height\nexport interface Shape { readonly width: number; readonly height: number }\n",
            "src/user.ts": [
              'import { area as size, type Shape } from "./lib.js"',
              "const unit: Shape = { width: 1, height: 1 }",
              "export const total = size(unit) + size(unit)",
              "export const passed = [unit].map(size)",
              "",
            ].join("\n"),
          },
        },
      ),
    { timeout: 60_000 },
  )
})
