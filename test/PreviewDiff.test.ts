import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { exists, read, withFixture } from "./utils/fixture.ts"

const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const lines = Array.from({ length: 24 }, (_, index) => `export const n${index} = ${index}\n`)
const before = lines.join("")
const after = lines.map((line, index) =>
  index === 4 || index === 19 ? line.replace("=", "= 1 +") : line
).join("")
const changes = {
  "distant.ts": after,
  "empty.ts": "export {}\n",
  "clear.ts": "",
  "newline.ts": "export {}\n",
  "unterminated.ts": "export {}",
}
const originals = {
  "distant.ts": before,
  "empty.ts": "",
  "clear.ts": "export {}\n",
  "newline.ts": "export {}",
  "unterminated.ts": "export {}\n",
  "deleted.ts": "export const gone = true\n",
}

const recipe = `
import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}
import { Proposal, Recipe, WorkspacePath } from ${
  JSON.stringify(new URL("../src/index.ts", import.meta.url).href)
}
const changes = ${JSON.stringify(changes)}
export default Recipe.perProject("preview-edges", {
  version: "1.0.0",
  run: (project) => Effect.gen(function* () {
    const files = yield* project.files
    return Proposal.concat(
      ...files.map((file) => file.fileName === "deleted.ts"
        ? Proposal.deleteFile(file)
        : Proposal.replaceText(file, changes[file.fileName])),
      Proposal.createFile(WorkspacePath.schema.make("created.ts"), "export const added = true\\n"),
      Proposal.createFile(WorkspacePath.schema.make("created-empty.ts"), ""),
    )
  }),
})
`

describe("preview diff", () => {
  effect(
    "renders contextual hunks, file operations, and exact newline changes without writing",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const result = spawnSync(process.execPath, [
            "--conditions=source",
            bin,
            "run",
            "recipe.ts",
          ], {
            cwd: root,
            encoding: "utf8",
          })
          expect(result.stderr).toBe("")
          expect(result.status, result.stdout).toBe(0)
          const output = result.stdout
          expect(output).toContain("@@ -2,7 +2,7 @@")
          expect(output).toContain("@@ -17,7 +17,7 @@")
          expect(output).toContain(
            " export const n3 = 3\n-export const n4 = 4\n+export const n4 = 1 + 4\n export const n5 = 5",
          )
          expect(output).not.toContain("export const n12")
          expect(output).toContain(
            "--- /dev/null\n+++ b/created.ts\n@@ -0,0 +1,1 @@\n+export const added = true",
          )
          expect(output).toContain(
            "--- a/deleted.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-export const gone = true",
          )
          expect(output).toContain("--- a/empty.ts\n+++ b/empty.ts\n@@ -0,0 +1,1 @@\n+export {}")
          expect(output).toContain("--- a/clear.ts\n+++ b/clear.ts\n@@ -1,1 +0,0 @@\n-export {}")
          expect(output).toContain(
            "--- a/newline.ts\n+++ b/newline.ts\n@@ -1,1 +1,1 @@\n-export {}\n\\ No newline at end of file\n+export {}",
          )
          expect(output).toContain(
            "--- a/unterminated.ts\n+++ b/unterminated.ts\n@@ -1,1 +1,1 @@\n-export {}\n+export {}\n\\ No newline at end of file",
          )
          expect(output).toContain("--- /dev/null\n+++ b/created-empty.ts\n")
          expect(yield* exists(root, "created.ts")).toBe(false)
          expect(yield* exists(root, "created-empty.ts")).toBe(false)
          for (const [name, original] of Object.entries(originals)) {
            expect(yield* read(root, name)).toBe(original)
          }
        }), {
        fixture: "empty",
        files: {
          ...originals,
          "recipe.ts": recipe,
          "tsconfig.json": JSON.stringify({
            compilerOptions: { noEmit: true, module: "NodeNext" },
            include: ["*.ts"],
            exclude: ["recipe.ts", "safemods.config.ts"],
          }),
          "safemods.config.ts":
            'export default { projects: [{ id: "app", config: "tsconfig.json" }] }',
        },
      }),
    { timeout: 60_000 },
  )
})
