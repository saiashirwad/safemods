import type { PlanInput } from "../../src/Plan.ts"

export const richInput: PlanInput = {
  recipe: {
    name: "test",
    version: "1",
    options: { enabled: true, nested: [null, 1, "x"] },
  },
  toolchain: { systemVersion: "1", typescriptVersion: "7", effectVersion: "4" },
  projects: [{ id: "app", configFileName: "tsconfig.json" }],
  sources: [
    { projectId: "app", fileName: "src/index.ts", hash: "source", kind: "file" },
    { projectId: "app", fileName: "src/delete.ts", hash: "delete", kind: "file" },
    { projectId: "app", fileName: "src/move.ts", hash: "move", kind: "file" },
  ],
  edits: [
    {
      projectId: "app",
      fileName: "src/index.ts",
      start: 0,
      end: 0,
      expectedTextHash: "empty",
      newText: "x",
      evidenceIds: ["edit"],
    },
  ],
  fileOperations: [
    {
      kind: "create",
      projectId: "app",
      path: "src/created.ts",
      content: "created",
      evidenceIds: ["create"],
    },
    {
      kind: "delete",
      projectId: "app",
      path: "src/delete.ts",
      initialHash: "delete",
      evidenceIds: ["delete"],
    },
    {
      kind: "move",
      projectId: "app",
      path: "src/move.ts",
      toPath: "src/moved.ts",
      initialHash: "move",
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
      projects: [{ id: "app", configFileName: "../tsconfig.json" }],
    }),
  },
  {
    name: "unsafe source path",
    mutate: (value) => ({
      ...value,
      sources: [{ ...value.sources[0]!, fileName: "/src/index.ts" }, ...value.sources.slice(1)],
    }),
  },
  {
    name: "unsafe edit path",
    mutate: (value) => ({ ...value, edits: [{ ...value.edits[0]!, fileName: "../index.ts" }] }),
  },
  {
    name: "unsafe operation path",
    mutate: (value) => withOperation(value, 0, (operation) => ({ ...operation, path: "C:/x" })),
  },
  {
    name: "unsafe move target path",
    mutate: (value) =>
      withOperation(value, 2, (operation) =>
        operation.kind === "move" ? { ...operation, toPath: "../x" } : operation,
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
    mutate: (value) => ({ ...value, edits: [{ ...value.edits[0]!, fileName: "src/other.ts" }] }),
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
      withOperation(value, 0, (operation) => ({ ...operation, path: "src/index.ts" })),
  },
  {
    name: "delete with a stale fingerprint",
    mutate: (value) =>
      withOperation(value, 1, (operation) =>
        operation.kind === "delete" ? { ...operation, initialHash: "stale" } : operation,
      ),
  },
  {
    name: "two operations on one path",
    mutate: (value) =>
      withOperation(value, 0, (operation) => ({ ...operation, path: "src/delete.ts" })),
  },
]
