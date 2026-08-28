import { path as Path, nodeFsPromises as Fs } from "../platform/node.ts"
import { Effect } from "effect"
import {
  Workspace,
  WorkspaceSnapshot,
  type ConfiguredProject,
  type ProjectSnapshot,
} from "../Workspace/index.ts"
import { withFixture } from "./declarative-fixture.ts"

/** Resolve the fixture's configured project in the active snapshot region. */
export const fixtureProject = (app: ConfiguredProject) =>
  WorkspaceSnapshot.use((snapshot) => snapshot.project(app))

/**
 * Copy the recipe fixture into a temp workspace, write the given extra
 * project-relative sources, and run `use` against one Project Snapshot.
 */
export const withProject = <A, E, R>(
  files: Record<string, string>,
  use: (project: ProjectSnapshot) => Effect.Effect<A, E, R>,
) =>
  withFixture((root, app) =>
    Effect.gen(function* () {
      for (const [relativePath, content] of Object.entries(files)) {
        const target = Path.join(root, relativePath)
        yield* Effect.tryPromise(() => Fs.mkdir(Path.dirname(target), { recursive: true }))
        yield* Effect.tryPromise(() => Fs.writeFile(target, content))
      }
      const workspace = yield* Workspace
      return yield* workspace.withSnapshot(
        {},
        Effect.gen(function* () {
          const project = yield* (yield* WorkspaceSnapshot).project(app)
          return yield* use(project)
        }),
      )
    }),
  )
