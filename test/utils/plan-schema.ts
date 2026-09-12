import type { PlanInput } from "../../src/Plan.ts"
import type * as ProjectRelativePath from "../../src/ProjectRelativePath.ts"
import * as Sha256 from "../../src/Sha256.ts"
import { projectId, projectPath } from "./domain.ts"

// SAFETY: semantic-mutation tests deliberately send invalid values through the decode boundary.
const uncheckedPath = (value: string) => value as ProjectRelativePath.Type
// SAFETY: semantic-mutation tests deliberately send invalid values through the decode boundary.
const uncheckedHash = (value: string) => value as Sha256.Type

export const richInput: PlanInput = {
  recipe: {
    name: "test",
    version: "1",
    options: { enabled: true, nested: [null, 1, "x"] },
  },
  toolchain: { systemVersion: "1", typescriptVersion: "7", effectVersion: "4" },
  projects: [{ id: projectId("app"), configFileName: projectPath("tsconfig.json") }],
  sources: [
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
      expectedTextHash: Sha256.digest("empty"),
      newText: "x",
      evidenceIds: ["edit"],
    },
  ],
  fileOperations: [
    {
      kind: "create",
      projectId: projectId("app"),
      path: projectPath("src/created.ts"),
      content: "created",
      evidenceIds: ["create"],
    },
    {
      kind: "delete",
      projectId: projectId("app"),
      path: projectPath("src/delete.ts"),
      initialHash: Sha256.digest("delete"),
      evidenceIds: ["delete"],
    },
    {
      kind: "move",
      projectId: projectId("app"),
      path: projectPath("src/move.ts"),
      toPath: projectPath("src/moved.ts"),
      initialHash: Sha256.digest("move"),
      content: "moved",
      evidenceIds: ["move"],
    },
  ],
  evidence: [
    { id: "edit", kind: "selection", facts: { nested: { valid: true } } },
    { id: "create", kind: "operation", facts: {} },
    { id: "delete", kind: "operation", facts: {} },
    { id: "move", kind: "operation", facts: {} },
  ],
  policies: {
    matchCount: { min: 1, max: 3 },
    maxAffectedFiles: 4,
    diagnostics: "no-new-errors",
    idempotence: "required",
  },
  measurements: { matches: 1 },
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

/** Well-shaped inputs that finalizePlan must still reject. */
export const semanticMutations: ReadonlyArray<{
  readonly name: string
  readonly mutate: (input: PlanInput) => PlanInput
}> = [
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
      withOperation(value, 0, (operation) => ({ ...operation, path: uncheckedPath("C:/x") })),
  },
  {
    name: "unsafe move target path",
    mutate: (value) =>
      withOperation(value, 2, (operation) =>
        operation.kind === "move" ? { ...operation, toPath: uncheckedPath("../x") } : operation,
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
    name: "duplicate evidence identity",
    mutate: (value) => ({ ...value, evidence: [...value.evidence, value.evidence[0]!] }),
  },
  {
    name: "inverted policy range",
    mutate: (value) => ({
      ...value,
      policies: { ...value.policies, matchCount: { min: 4, max: 3 } },
    }),
  },
  {
    name: "edit on a file that is not a source",
    mutate: (value) => ({
      ...value,
      edits: [{ ...value.edits[0]!, fileName: projectPath("src/other.ts") }],
    }),
  },
  {
    name: "missing edit evidence link",
    mutate: (value) => ({ ...value, edits: [{ ...value.edits[0]!, evidenceIds: ["unknown"] }] }),
  },
  {
    name: "missing operation evidence link",
    mutate: (value) =>
      withOperation(value, 1, (operation) => ({ ...operation, evidenceIds: ["unknown"] })),
  },
  {
    name: "create over an existing source",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({
        ...operation,
        path: projectPath("src/index.ts"),
      })),
  },
  {
    name: "delete with a stale fingerprint",
    mutate: (value) =>
      withOperation(value, 1, (operation) =>
        operation.kind === "delete"
          ? { ...operation, initialHash: uncheckedHash("stale") }
          : operation,
      ),
  },
  {
    name: "two operations on one path",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({
        ...operation,
        path: projectPath("src/delete.ts"),
      })),
  },
]
