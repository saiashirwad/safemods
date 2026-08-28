# Architecture

Safemods separates finding changes, describing them, proving they are safe, and writing them. The main design rule is authority: a value from an earlier stage cannot be used to skip a later stage.

## System map

```text
Configured Project
       │
       ▼
Workspace ── opens ──► Workspace Snapshot
                            │
                            ▼
                      Project Snapshot
                            │
                 Recipe runs in this region
                            │
            Query/Pattern ──► Selection ──► Draft
                            │
                     Recipe.run finalizes
                            │
                            ▼
                   Transformation Plan
                            │
                  preview and verification
                            │
                            ▼
                       Verified Plan
                            │
                            ▼
                        Application
```

A native compiler value is valid only while its Workspace Snapshot is active. A Draft can propose edits but cannot write them. A Transformation Plan is durable but still cannot be applied. Successful verification creates the process-local Verified Plan required by Application.

Overlay supports sequential recipes. It runs a later step against an in-memory view of earlier Draft changes, then rebases the combined result onto the original snapshot. It does not grant write authority.

## Canonical execution trace

The CLI preview, verification, and application modes share one orchestrator:

```text
bin/safemods.ts
  parse command and options
    │
    ▼
src/Cli/Run.ts: runCli
  load the Recipe and provide Node adapters
    │
    ▼
src/Execution/RecipeExecution.ts: executeRecipe
    │
    ├─ src/Recipe/Run.ts: run
    │    validate input
    │    open Workspace Snapshot
    │    execute Recipe.run
    │    finalize Draft evidence
    │    fingerprint recorded workspace observations
    │    finalize Transformation Plan
    │
    ├─ src/Verification/Preview.ts: of
    │    materialize the proposed result in memory
    │
    ├─ src/Verification/Verify.ts: verify
    │    revalidate plan, recipe, input, policies, and project identity
    │    compare baseline and proposed compiler diagnostics
    │    replay recipes that promise idempotence
    │    evaluate policies and issue a Verified Plan
    │
    └─ src/Application/index.ts: apply
         revalidate before writing
         write or roll back
         return an Application Receipt
```

`scan` diverges after planning. It builds a report from the Plan's recorded matches without running verification or Application. It still executes the Recipe and builds a complete Transformation Plan.

`AgentTool` also calls `executeRecipe`: verification is its default, while its apply option provides the Application adapter.

## Authority by stage

| Value or region     | May query compiler          | May describe changes                 | Durable       | May write                |
| ------------------- | --------------------------- | ------------------------------------ | ------------- | ------------------------ |
| Workspace Snapshot  | Yes                         | No                                   | No            | No                       |
| Project Snapshot    | Yes                         | No                                   | No            | No                       |
| Selection           | Refers to one snapshot      | No                                   | No            | No                       |
| Draft               | Through its active snapshot | Yes                                  | No            | No                       |
| Transformation Plan | No                          | Contains frozen changes              | Yes           | No                       |
| Verified Plan       | No                          | Contains a verified plan and preview | Process-local | Yes, through Application |
| Application Receipt | No                          | Reports completed outputs            | Yes           | No                       |

## Module groups

Start with the author-facing modules. Read adapters and low-level formats only when working on them.

### Recipe authoring

| Module      | Role                                               |
| ----------- | -------------------------------------------------- |
| `Workspace` | Configured projects and snapshot regions           |
| `Query`     | Semantic and structural selection streams          |
| `Pattern`   | Reusable syntax shapes for queries                 |
| `Draft`     | Proposed text and file changes                     |
| `Recipe`    | Input, policies, recipe body, and composition      |
| `Policy`    | Built-in constraints and custom verification rules |

### Safety pipeline

| Module         | Role                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `Overlay`      | In-memory composition of sequential Drafts                               |
| `Plan`         | Durable transformation format and validation                             |
| `Verification` | Preview, revalidation, diagnostics, policies, and Verified Plan issuance |
| `Application`  | The only write authority                                                 |

### Low-level mechanics

| Module        | Role                                                   |
| ------------- | ------------------------------------------------------ |
| `Edit`        | Guarded text-edit format and application mechanics     |
| `Evidence`    | Durable facts connecting selections and proposed work  |
| `VirtualFs`   | Read-only in-memory filesystem state used for overlays |
| `ProjectPath` | Portable project-relative path validation              |

### Adapters and entry points

| Module      | Role                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `Node`      | Node filesystem, path, compiler, Workspace, and Application adapters |
| `Cli`       | Terminal orchestration and rendering                                 |
| `AgentTool` | Structured tool interface for agent hosts                            |
| `Execution` | Internal shared orchestration used by CLI and AgentTool              |

`Application`, `AgentTool`, `Cli`, `Draft`, `Edit`, `Evidence`, `Overlay`, `Pattern`, `Plan`, `Policy`, `ProjectPath`, `Query`, `Recipe`, `Verification`, `VirtualFs`, `Workspace`, and `Node` are published package subpaths. `Execution` is an internal source owner.

## Dependency rules

`tools/check-boundaries.mjs` enforces these source layers, from lowest to highest:

1. `Edit`, `Evidence`, `Plan`, `Policy`, `ProjectPath`, `VirtualFs`, generated values
2. `Pattern`, `Query`, `Workspace`
3. `Draft`, `Overlay`
4. `Application`, `Execution`, `Recipe`, `Verification`
5. `Node`, platform adapters
6. `AgentTool`, `Cli`, `bin`

A module may import its own layer or a lower layer. The checker also gives assembly modules such as Recipe and Verification narrower explicit dependency sets. Imports from another owner's `internal` directory are forbidden. The root facade may expose only its listed public owners.

Run the check directly with:

```sh
node tools/check-boundaries.mjs
```

## Reading order

1. `CONTEXT.md`
2. `src/Workspace/ConfiguredProject.ts`
3. `src/Workspace/SnapshotRegion.ts`
4. The `ProjectFile` and `ProjectSnapshot` interfaces in `src/Workspace/ProjectSnapshot.ts`
5. `src/Query/Query.ts` and `src/Pattern/index.ts`
6. `src/Draft/Draft.ts`
7. `src/Recipe/Recipe.ts`, `Run.ts`, and `Combinators.ts`
8. `src/Overlay/index.ts`
9. `src/Plan/TransformationPlan.ts` and `Finalize.ts`
10. `src/Verification/Preview.ts`, `Verify.ts`, and `VerifiedPlan.ts`
11. `src/Application/Application.ts`
12. `src/Execution/RecipeExecution.ts`
13. `Node`, `Cli`, and `AgentTool` last

On a first pass, read interfaces and orchestration functions. Internal AST traversal, filesystem adapters, codecs, and rendering can wait until a change requires them.
