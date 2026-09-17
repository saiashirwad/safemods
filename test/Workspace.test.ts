import { NodeServices } from "@effect/platform-node"
import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import {
  ProjectNotInWorkspace,
  SnapshotExpired,
  Workspace,
  WorkspaceDefinition,
  WorkspaceSnapshot,
  layer as workspaceLayer,
} from "../src/Workspace/index.ts"
import { projectPath } from "./utils/domain.ts"
import { fixturePath, fixtureProject, withFixture, withProject, write } from "./utils/fixture.ts"

const libraryPath = projectPath("src/library.ts")

describe("workspace snapshots", () => {
  effect("rejects unsafe, empty, and duplicate project definitions", () =>
    Effect.gen(function* () {
      const app = { id: "app", config: "tsconfig.json" }
      for (const projects of [
        [],
        [{ id: "app", config: "../tsconfig.json" }],
        [{ id: "app", config: "/tmp/tsconfig.json" }],
        [{ id: "", config: "tsconfig.json" }],
        [{ id: "app\0other", config: "tsconfig.json" }],
        [app, { id: "app", config: "other.json" }],
        [app, { id: "other", config: "tsconfig.json" }],
      ]) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(WorkspaceDefinition.schema)({ projects }),
        )
        expect({ projects, outcome: exit._tag }).toEqual({ projects, outcome: "Failure" })
      }
      const valid = yield* WorkspaceDefinition.make({ projects: [app] })
      expect(valid.projects).toEqual([app])
    }),
  )

  effect("rejects overlapping physical source ownership", () =>
    Effect.gen(function* () {
      const definition = yield* WorkspaceDefinition.make({
        projects: [
          { id: "root", config: "tsconfig.json" },
          { id: "nested", config: "nested/tsconfig.json" },
        ],
      })
      const result = yield* Workspace.use((workspace) =>
        workspace.withSnapshot(WorkspaceSnapshot).pipe(Effect.result),
      ).pipe(
        Effect.provide(
          Layer.merge(workspaceLayer(definition, fixturePath("multi-overlap")), NodeServices.layer),
        ),
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "OverlappingProjectOwnership",
          fileName: Path.join(fixturePath("multi-overlap"), "nested/src/shared.ts"),
          projectIds: ["root", "nested"],
        },
      })
    }),
  )

  effect("exposes owned files by portable path", () =>
    withProject({}, (project) =>
      Effect.gen(function* () {
        const library = yield* project.file(libraryPath)
        expect(library?.sourceFile.text).toContain("function target")
        expect(Option.getOrUndefined(project.fileNameOf(library!.sourceFile))).toBe(libraryPath)
        expect((yield* project.files).map((file) => file.fileName)).toContain(libraryPath)
      }),
    ),
  )

  effect("unknown workspace projects fail through the typed channel", () =>
    withFixture(() =>
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const unknown = "unknown" as WorkspaceDefinition.Type["projects"][number]["id"]
        expect(yield* Effect.flip(workspace.projectRoot(unknown))).toBeInstanceOf(
          ProjectNotInWorkspace,
        )
        expect(
          yield* Effect.flip(workspace.absolutePath({ projectId: unknown, fileName: libraryPath })),
        ).toBeInstanceOf(ProjectNotInWorkspace)
      }),
    ),
  )

  effect("fileNameOf returns None for a source file outside its project", () =>
    withProject({}, (project) =>
      Effect.gen(function* () {
        const library = yield* project.file(libraryPath)
        const external = { ...library!.sourceFile, fileName: "/outside/project.ts" }
        expect(Option.isNone(project.fileNameOf(external))).toBe(true)
      }),
    ),
  )

  effect("every snapshot reads the current disk state", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const libraryText = workspace.withSnapshot(
          Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            return (yield* project.file(libraryPath))?.sourceFile.text
          }),
        )
        expect(yield* libraryText).toContain("function target")
        yield* write(root, libraryPath, "export const rewritten = 1\n")
        expect(yield* libraryText).toBe("export const rewritten = 1\n")
      }),
    ),
  )

  effect("an overlay replaces, adds, and hides files without touching disk", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const created = projectPath("src/virtual-dir/created.ts")
        const overlay = {
          files: new Map([
            [Path.join(root, created), "export const created = 1\n"],
            [Path.join(root, libraryPath), "export const replaced = 1\n"],
          ]),
          deleted: new Set([Path.join(root, "src/barrel.ts")]),
        }
        yield* workspace.withSnapshot(
          Effect.gen(function* () {
            const project = yield* fixtureProject(app)
            expect((yield* project.file(created))?.sourceFile.text).toBe(
              "export const created = 1\n",
            )
            expect((yield* project.file(libraryPath))?.sourceFile.text).toBe(
              "export const replaced = 1\n",
            )
            expect(yield* project.file(projectPath("src/barrel.ts"))).toBeUndefined()
          }),
          overlay,
        )
      }),
    ),
  )

  effect("an overlay snapshot still sees files behind symlinked directories", () =>
    withFixture((root, app) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await Fs.mkdir(Path.join(root, "real"))
          await Fs.writeFile(Path.join(root, "real/linked.ts"), "export const linked = 1\n")
          await Fs.symlink(Path.join(root, "real"), Path.join(root, "src/link"), "dir")
        })
        const workspace = yield* Workspace
        const fileNames = Effect.gen(function* () {
          const project = yield* fixtureProject(app)
          return (yield* project.files).map((file) => file.fileName).sort()
        })
        const onDisk = yield* workspace.withSnapshot(fileNames)
        const overlaid = yield* workspace.withSnapshot(fileNames, {
          files: new Map(),
          deleted: new Set(),
        })
        expect(onDisk).toContain("src/link/linked.ts")
        expect(overlaid).toEqual(onDisk)
      }),
    ),
  )

  effect("symbolNamed resolves aliases and re-exports to one canonical symbol", () =>
    withProject({}, (project) =>
      Effect.gen(function* () {
        const named = (name: string, within: string) =>
          project.symbolNamed(name, { within: projectPath(within) })
        const original = yield* named("target", "src/library.ts")
        expect(yield* named("renamed", "src/consumer.ts")).toBe(original)
        expect(yield* named("publicTarget", "src/barrel.ts")).toBe(original)
        expect(yield* named("publicTarget", "src/reexport-consumer.ts")).toBe(original)

        const missing = yield* Effect.flip(named("absent", "src/library.ts"))
        expect(missing._tag).toBe("SymbolNotFound")
      }),
    ),
  )

  effect("fails with SnapshotExpired when a project snapshot outlives its region", () =>
    withFixture((_, app) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace
        const escaped = yield* workspace.withSnapshot(fixtureProject(app))
        expect(yield* Effect.flip(escaped.files)).toBeInstanceOf(SnapshotExpired)
        expect(
          yield* Effect.flip(escaped.symbolNamed("target", { within: libraryPath })),
        ).toBeInstanceOf(SnapshotExpired)
      }),
    ),
  )
})
