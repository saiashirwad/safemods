import type { PlanInput } from "../../src/Plan.ts"
import type * as ProjectRelativePath from "../../src/ProjectRelativePath.ts"
import * as Sha256 from "../../src/Sha256.ts"
import { projectId, projectPath } from "./domain.ts"

const uncheckedPath = (value: string) => value as ProjectRelativePath.Type

export const richInput: PlanInput = {
  recipe: {
    name: "test",
    version: "1",
    options: { enabled: true, nested: [null, 1, "x"] },
  },
  projects: [{ id: projectId("app"), configFileName: projectPath("tsconfig.json") }],
  sources: [
    {
      projectId: projectId("app"),
      fileName: projectPath("src/created.ts"),
      kind: "missing",
    },
    {
      projectId: projectId("app"),
      fileName: projectPath("src/moved.ts"),
      kind: "missing",
    },
    {
      projectId: projectId("app"),
      fileName: projectPath("src/index.ts"),
      hash: Sha256.digest("source"),
      kind: "file",
    },
    {
      projectId: projectId("app"),
      fileName: projectPath("src/delete.ts"),
      hash: Sha256.digest("delete"),
      kind: "file",
    },
    {
      projectId: projectId("app"),
      fileName: projectPath("src/move.ts"),
      hash: Sha256.digest("move"),
      kind: "file",
    },
  ],
  edits: [
    {
      projectId: projectId("app"),
      fileName: projectPath("src/index.ts"),
      start: 0,
      end: 0,
      expectedTextHash: Sha256.digest(""),
      newText: "x",
    },
  ],
  unsupported: [],
  fileOperations: [
    {
      kind: "create",
      projectId: projectId("app"),
      fileName: projectPath("src/created.ts"),
      content: "created",
    },
    {
      kind: "delete",
      projectId: projectId("app"),
      fileName: projectPath("src/delete.ts"),
    },
    {
      kind: "move",
      projectId: projectId("app"),
      fileName: projectPath("src/move.ts"),
      toFileName: projectPath("src/moved.ts"),
    },
  ],
  policies: {
    maxAffectedFiles: 4,
    diagnostics: "no-new-errors",
    idempotence: "required",
  },
}

const withOperation = (
  input: PlanInput,
  index: number,
  patch: (operation: PlanInput["fileOperations"][number]) => PlanInput["fileOperations"][number],
): PlanInput => ({
  ...input,
  fileOperations: input.fileOperations.map((operation, current) =>
    current === index ? patch(operation) : operation,
  ),
})

export const semanticMutations: ReadonlyArray<{
  readonly name: string
  readonly mutate: (input: PlanInput) => PlanInput
}> = [
  {
    name: "no projects",
    mutate: (value) => ({ ...value, projects: [], sources: [], edits: [], fileOperations: [] }),
  },
  {
    name: "two project IDs for the same config path",
    mutate: (value) => ({
      ...value,
      projects: [...value.projects, { ...value.projects[0]!, id: projectId("other") }],
    }),
  },
  {
    name: "one project ID for two config paths",
    mutate: (value) => ({
      ...value,
      projects: [...value.projects, { ...value.projects[0]!, configFileName: "other.json" }],
    }),
  },
  {
    name: "one source is both a file and missing",
    mutate: (value) => ({
      ...value,
      sources: [...value.sources, { projectId: "app", fileName: "src/index.ts", kind: "missing" }],
    }),
  },
  ...["src/created.ts", "src/moved.ts"].map((fileName) => ({
    name: `no absence fingerprint for ${fileName}`,
    mutate: (value: PlanInput): PlanInput => ({
      ...value,
      sources: value.sources.filter((source) => source.fileName !== fileName),
    }),
  })),
  {
    name: "edit conflicts with delete",
    mutate: (value) => ({ ...value, edits: [{ ...value.edits[0]!, fileName: "src/delete.ts" }] }),
  },
  {
    name: "one disk file changed through two projects",
    mutate: (value) => ({
      ...value,
      projects: [...value.projects, { id: "other", configFileName: "other.json" }],
      sources: [...value.sources, { ...value.sources[2]!, projectId: "other" }],
      edits: [...value.edits, { ...value.edits[0]!, projectId: "other" }],
    }),
  },
  {
    name: "overlapping edits",
    mutate: (value) => ({ ...value, edits: [...value.edits, value.edits[0]!] }),
  },
  ...[0, 1, 2].map((index) => ({
    name: `repeated ${richInput.fileOperations[index]!.kind}`,
    mutate: (value: PlanInput): PlanInput => ({
      ...value,
      fileOperations: [...value.fileOperations, value.fileOperations[index]!],
    }),
  })),
  {
    name: "create and move to the same target",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({ ...operation, fileName: "src/moved.ts" })),
  },
  {
    name: "delete and move the same source",
    mutate: (value) =>
      withOperation(value, 1, (operation) => ({
        ...operation,
        fileName: "src/move.ts",
      })),
  },
  {
    name: "move to an existing source",
    mutate: (value) =>
      withOperation(value, 2, (operation) =>
        operation.kind === "move" ? { ...operation, toFileName: "src/index.ts" } : operation,
      ),
  },
  {
    name: "move to the same path",
    mutate: (value) =>
      withOperation(value, 2, (operation) =>
        operation.kind === "move" ? { ...operation, toFileName: operation.fileName } : operation,
      ),
  },
  {
    name: "unsafe project path",
    mutate: (value) => ({
      ...value,
      projects: [{ id: projectId("app"), configFileName: uncheckedPath("../tsconfig.json") }],
    }),
  },
  {
    name: "unsafe source path",
    mutate: (value) => ({
      ...value,
      sources: [
        { ...value.sources[0]!, fileName: uncheckedPath("/src/index.ts") },
        ...value.sources.slice(1),
      ],
    }),
  },
  {
    name: "unsafe edit path",
    mutate: (value) => ({
      ...value,
      edits: [{ ...value.edits[0]!, fileName: uncheckedPath("../index.ts") }],
    }),
  },
  {
    name: "unsafe operation path",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({ ...operation, fileName: uncheckedPath("C:/x") })),
  },
  {
    name: "unsafe move target path",
    mutate: (value) =>
      withOperation(value, 2, (operation) =>
        operation.kind === "move" ? { ...operation, toFileName: uncheckedPath("../x") } : operation,
      ),
  },
  {
    name: "duplicate project identity",
    mutate: (value) => ({ ...value, projects: [...value.projects, value.projects[0]!] }),
  },
  {
    name: "duplicate source identity",
    mutate: (value) => ({ ...value, sources: [...value.sources, value.sources[0]!] }),
  },
  {
    name: "edit on a file that is not a source",
    mutate: (value) => ({
      ...value,
      edits: [{ ...value.edits[0]!, fileName: projectPath("src/other.ts") }],
    }),
  },
  {
    name: "create over an existing source",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({
        ...operation,
        fileName: projectPath("src/index.ts"),
      })),
  },
  {
    name: "two operations on one path",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({
        ...operation,
        fileName: projectPath("src/delete.ts"),
      })),
  },
]
