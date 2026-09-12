import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import {
  ConfiguredProject,
  DuplicateConfiguredProject,
  SnapshotExpired,
  Workspace,
  WorkspaceDefinition,
} from "../src/Workspace/index.ts"
import { InvalidProjectRelativePath } from "../src/ProjectRelativePath.ts"
import { InvalidProjectId } from "../src/ProjectId.ts"
import { withFixture } from "./utils/declarative-fixture.ts"
import { fixtureProject } from "./utils/project-fixture.ts"
import { projectPath } from "./utils/domain.ts"

describe("workspace path confinement, overlay FS, and symbol lookup", () => {
  effect("rejects invalid project identities and duplicate workspace entries", () =>
    withFixture((_, app) =>
      Effect.gen(function* () {
        for (const config of ["../tsconfig.json", "/tmp/tsconfig.json"]) {
          const failure = yield* ConfiguredProject.make({ id: "escaped", config }).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(InvalidProjectRelativePath)
        }
        for (const id of ["", "app\0other"]) {
          const failure = yield* ConfiguredProject.make({ id, config: "tsconfig.json" }).pipe(
            Effect.flip,
          )
          expect(failure).toBeInstanceOf(InvalidProjectId)
        }

        const duplicateId = yield* ConfiguredProject.make({ id: "app", config: "other.json" })
        const duplicateConfig = yield* ConfiguredProject.make({ id: "other", config: app.config })
        for (const projects of [[app, duplicateId] as const, [app, duplicateConfig] as const]) {
          const failure = yield* WorkspaceDefinition.make({ projects }).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(DuplicateConfiguredProject)
        }
      }),
    ),
  )

  effect(
    "exposes portable paths and source files without host paths",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            {},
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const libraryPath = projectPath("src/library.ts")
              const library = yield* project.file(libraryPath)
              const source = yield* library.sourceFile
              expect(project.pathOf(source)).toBe(libraryPath)
              expect(yield* library.sourceText).toContain("function target")
              expect((yield* project.files).map((file) => file.path)).toContain(libraryPath)
            }),
          )
        }),
      ),
    60_000,
  )

  effect(
    "delegates isolated overlay reads to the caller filesystem",
    () => {
      const marker = "export const fromCallback = 1;\n"
      const recipeFixture = fileURLToPath(new URL("../fixtures/recipe/", import.meta.url))
      return withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const disk = yield* Effect.tryPromise(() =>
              Fs.readFile(Path.join(root, "src/library.ts"), "utf8"),
            )
            const workspace = yield* Workspace
            yield* workspace.withIsolatedSnapshot(
              { files: new Map(), created: new Set(), deleted: new Set() },
              Effect.gen(function* () {
                const project = yield* fixtureProject(app)
                const text = yield* project.sourceText(projectPath("src/library.ts"))
                expect(text).toBe(marker)
                expect(disk).not.toBe(marker)
              }),
            )
          }),
        {
          fixturePath: recipeFixture,
          fs: {
            readFile: (fileName) => {
              const normalized = fileName.replaceAll("\\", "/")
              return normalized.endsWith("src/library.ts") ? marker : undefined
            },
            fileExists: (fileName) => {
              const normalized = fileName.replaceAll("\\", "/")
              return normalized.endsWith("src/library.ts") ? true : undefined
            },
          },
        },
      )
    },
    60_000,
  )

  effect(
    "exposes a file created in a new virtual directory through the isolated snapshot",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const createdPath = Path.join(root, "src/virtual-dir/created.ts")
          const content = "export const created = 1;\n"
          const workspace = yield* Workspace
          yield* workspace.withIsolatedSnapshot(
            {
              files: new Map([[createdPath, content]]),
              created: new Set([createdPath]),
              deleted: new Set(),
            },
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const created = yield* project.file(projectPath("src/virtual-dir/created.ts"))
              expect(created.path).toBe("src/virtual-dir/created.ts")
              expect(yield* created.sourceText).toBe(content)
            }),
          )
        }),
      ),
    60_000,
  )

  effect(
    "resolves query-fixture aliases and re-exports with symbolNamed",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            {},
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const original = yield* project.symbolNamed("target", {
                within: projectPath("src/library.ts"),
              })
              const aliased = yield* project.symbolNamed("renamed", {
                within: projectPath("src/consumer.ts"),
              })
              const reexported = yield* project.symbolNamed("publicTarget", {
                within: projectPath("src/barrel.ts"),
              })
              const throughBarrel = yield* project.symbolNamed("publicTarget", {
                within: projectPath("src/reexport-consumer.ts"),
              })
              expect(aliased).toBe(original)
              expect(reexported).toBe(original)
              expect(throughBarrel).toBe(original)
            }),
          )
        }),
      ),
    60_000,
  )

  effect(
    "resolves batched symbols directly on project snapshot",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.withSnapshot(
            {},
            Effect.gen(function* () {
              const project = yield* fixtureProject(app)
              const libraryPath = projectPath("src/library.ts")
              const source = yield* project.sourceFile(libraryPath)
              expect(source).toBeDefined()
              if (source === undefined) return

              const positions = [source.getStart(source)]
              const symbols = yield* project.symbolsAt(libraryPath, positions)
              expect(symbols).toHaveLength(1)
            }),
          )
        }),
      ),
    60_000,
  )

  effect(
    "fails with SnapshotExpired when a project snapshot outlives its region",
    () =>
      withFixture((_, app) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace
          const escaped = yield* workspace.withSnapshot({}, fixtureProject(app))
          const sourceText = yield* escaped
            .sourceText(projectPath("src/library.ts"))
            .pipe(Effect.flip)
          const symbol = yield* escaped
            .symbolNamed("target", { within: projectPath("src/library.ts") })
            .pipe(Effect.flip)
          expect(sourceText).toBeInstanceOf(SnapshotExpired)
          expect(symbol).toBeInstanceOf(SnapshotExpired)
        }),
      ),
    60_000,
  )
})
