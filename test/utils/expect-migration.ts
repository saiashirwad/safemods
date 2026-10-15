import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { expect } from "@effect/vitest"
import { Effect } from "effect"
import type * as Recipe from "../../src/Recipe.ts"
import type { ConfiguredProject } from "../../src/Workspace/index.ts"
import { executeRecipe, proposalOf } from "./execute-recipe.ts"
import { fixturePath, withFixture } from "./fixture.ts"

/** Every file under `root` by portable relative path. */
const readTree = async (root: string): Promise<Record<string, string>> => {
  const tree: Record<string, string> = {}
  const entries = await Fs.readdir(root, { recursive: true, withFileTypes: true })
  for (
    const entry of entries.filter((entry) => entry.isFile()).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )
  ) {
    const file = Path.join(entry.parentPath, entry.name)
    tree[Path.relative(root, file).split(Path.sep).join("/")] = await Fs.readFile(file, "utf8")
  }
  return tree
}

const expectTree = (root: string, fixture: string) =>
  Effect.promise(async () => {
    const expectedRoot = Path.join(fixturePath(fixture), "expected")
    const actual = await readTree(root)
    if (process.env.UPDATE_FIXTURES === "1") {
      await Fs.rm(expectedRoot, { recursive: true, force: true })
      for (const [fileName, content] of Object.entries(actual)) {
        await Fs.mkdir(Path.dirname(Path.join(expectedRoot, fileName)), { recursive: true })
        await Fs.writeFile(Path.join(expectedRoot, fileName), content)
      }
    } else {
      expect(actual).toEqual(await readTree(expectedRoot))
    }
  })

/**
 * Copies `fixtures/<fixture>`, runs and applies `recipe`, and asserts that the
 * resulting tree equals `fixtures/<fixture>/expected` and that a second run proposes
 * nothing (returned as `rerun`). `UPDATE_FIXTURES=1` rewrites `expected` from the actual output instead.
 * Recipes that take an input receive it from `input(project)`.
 */
export const expectMigration = <Input, E, R>(
  recipe: Recipe.Definition<Input, E, R>,
  fixture: string,
  input?: (project: ConfiguredProject.Type) => Input,
) =>
  withFixture(
    (root, project) =>
      Effect.gen(function* () {
        const value = input?.(project) as Input
        const result = yield* executeRecipe(recipe, value)
        yield* expectTree(root, fixture)
        const rerun = yield* proposalOf(recipe, value)
        expect(rerun.edits).toEqual([])
        return { ...result, rerun }
      }),
    { fixture },
  )
