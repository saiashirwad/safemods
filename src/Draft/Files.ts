import { hash } from "node:crypto"
import { Effect } from "effect"
import {
  InvalidProjectRelativePath,
  parseProjectRelativePath,
  type ProjectRelativePath,
} from "../ProjectPath.ts"
import type { FileNotFound, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"
import type { Draft } from "./Draft.ts"

export const files = {
  /** Propose creating a new source file in the project with initial content. */
  create: (
    project: ProjectSnapshot,
    relativePath: string,
    content: string,
  ): Effect.Effect<Draft, ProjectSnapshotError | InvalidProjectRelativePath> =>
    Effect.gen(function* () {
      const path = yield* checkedPath(relativePath)
      yield* project.sourceFile(path)
      return {
        edits: [],
        fileOperations: [
          {
            kind: "create",
            projectId: project.project.id,
            path,
            content,
            evidenceIds: [`file:create:${project.project.id}:${path}`],
          },
        ],
        evidence: [
          {
            id: `file:create:${project.project.id}:${path}`,
            kind: "file-operation",
            facts: { kind: "create", projectId: project.project.id, path },
          },
        ],
        matches: 1,
      }
    }),

  /** Propose deleting an existing source file from the project. */
  delete: (
    project: ProjectSnapshot,
    relativePath: string,
  ): Effect.Effect<Draft, ProjectSnapshotError | FileNotFound | InvalidProjectRelativePath> =>
    Effect.gen(function* () {
      const path = yield* checkedPath(relativePath)
      const source = yield* project.sourceText(path)
      return {
        edits: [],
        fileOperations: [
          {
            kind: "delete",
            projectId: project.project.id,
            path,
            initialHash: hash("sha256", source, "hex"),
            evidenceIds: [`file:delete:${project.project.id}:${path}`],
          },
        ],
        evidence: [
          {
            id: `file:delete:${project.project.id}:${path}`,
            kind: "file-operation",
            facts: { kind: "delete", projectId: project.project.id, path },
          },
        ],
        matches: 1,
      }
    }),

  /** Propose moving/renaming a source file, carrying its content unchanged. */
  move: (
    project: ProjectSnapshot,
    fromPath: string,
    toPath: string,
  ): Effect.Effect<Draft, ProjectSnapshotError | FileNotFound | InvalidProjectRelativePath> =>
    Effect.gen(function* () {
      const sourcePath = yield* checkedPath(fromPath)
      const targetPath = yield* checkedPath(toPath)
      const source = yield* project.sourceText(sourcePath)
      const moveEvidence = `file:move:${project.project.id}:${sourcePath}->${targetPath}`
      return {
        edits: [],
        fileOperations: [
          {
            kind: "move",
            projectId: project.project.id,
            path: sourcePath,
            toPath: targetPath,
            content: source,
            initialHash: hash("sha256", source, "hex"),
            evidenceIds: [moveEvidence],
          },
        ],
        evidence: [
          {
            id: moveEvidence,
            kind: "file-operation",
            facts: {
              kind: "move",
              projectId: project.project.id,
              path: sourcePath,
              toPath: targetPath,
            },
          },
        ],
        matches: 1,
      }
    }),
}

const checkedPath = (
  value: string,
): Effect.Effect<ProjectRelativePath, InvalidProjectRelativePath> => {
  const path = parseProjectRelativePath(value)
  return path === undefined
    ? Effect.fail(new InvalidProjectRelativePath({ path: value }))
    : Effect.succeed(path)
}
