import { Effect } from "effect"
import type * as ProjectRelativePath from "../ProjectRelativePath.ts"
import * as Sha256 from "../Sha256.ts"
import type { FileNotFound, ProjectSnapshot, ProjectSnapshotError } from "../Workspace/index.ts"
import type { Draft } from "./Draft.ts"

export const files = {
  /** Propose creating a new source file in the project with initial content. */
  create: (
    project: ProjectSnapshot,
    path: ProjectRelativePath.Type,
    content: string,
  ): Effect.Effect<Draft, ProjectSnapshotError> =>
    Effect.gen(function* () {
      yield* project.sourceFile(path)
      const createEvidence = `file:create:${project.project.id}:${path}`
      return {
        edits: [],
        fileOperations: [
          {
            kind: "create",
            projectId: project.project.id,
            path,
            content,
            evidenceIds: [createEvidence],
          },
        ],
        evidence: [
          {
            id: createEvidence,
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
    path: ProjectRelativePath.Type,
  ): Effect.Effect<Draft, ProjectSnapshotError | FileNotFound> =>
    Effect.gen(function* () {
      const source = yield* project.sourceText(path)
      const deleteEvidence = `file:delete:${project.project.id}:${path}`
      return {
        edits: [],
        fileOperations: [
          {
            kind: "delete",
            projectId: project.project.id,
            path,
            initialHash: Sha256.digest(source),
            evidenceIds: [deleteEvidence],
          },
        ],
        evidence: [
          {
            id: deleteEvidence,
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
    fromPath: ProjectRelativePath.Type,
    toPath: ProjectRelativePath.Type,
  ): Effect.Effect<Draft, ProjectSnapshotError | FileNotFound> =>
    Effect.gen(function* () {
      const source = yield* project.sourceText(fromPath)
      const moveEvidence = `file:move:${project.project.id}:${fromPath}->${toPath}`
      return {
        edits: [],
        fileOperations: [
          {
            kind: "move",
            projectId: project.project.id,
            path: fromPath,
            toPath,
            content: source,
            initialHash: Sha256.digest(source),
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
              path: fromPath,
              toPath,
            },
          },
        ],
        matches: 1,
      }
    }),
}
