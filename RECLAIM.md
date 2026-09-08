# safemods: reading guide for reclaiming the core

Working document, 2026-09-08, written from commit `c3c1813`. Nothing here is shipped documentation. Replace it with your own spec as you read; delete sections as they stop being news.

Claims marked **(verified)** were checked by hand against source. Everything else is from reading and should be re-checked as you reach that file.

## 0. Where things stand

Between `d7ae881` and `c3c1813` the repo was cut from roughly 8,500 lines of source to 4,229, and tests from about 5,000 lines to 2,737. What remains is one pipeline and the vocabulary it needs. Everything that was a codemod or a convenience built on top of that pipeline is gone and is inventoried in `RETIRED-CANDIDATES.md`.

The goal now is not to add anything back. It is to make the six stages below correct, tested against their contracts, and honest about what they promise. Only when that is true does it make sense to decide what safemods is and rebuild the upper layers on it.

## 1. The one idea

A codemod is not a script that edits files. It is a **durable, re-verifiable plan**.

```
recipe  ──run──▶  Draft  ──finalize──▶  Plan  ──verify──▶  VerifiedPlan  ──apply──▶  disk
        (compiler          (edits +         (content-       (preview +          (temp file +
         snapshot)          evidence)         addressed)      diag diff)          rename)
```

Every arrow is a boundary where the previous artifact is checked, never trusted. That is what makes it "safe". Everything else in `src/` is either vocabulary for these stages or a helper for writing recipes.

## 2. Vocabulary

**Native compiler handle.** A live TypeScript 7 (`tsgo`) process reached through `typescript/unstable/async`, opened with `acquireRelease` so it closes with its Effect scope. `src/Workspace/internal/NativeCompiler.ts`.

**Snapshot.** One frozen state of that compiler's view of the world, obtained by `api.updateSnapshot(...)`, optionally with lists of changed, created, and deleted files. It has a numeric generation.

**Snapshot region.** The Effect scope inside which a snapshot may be used. On exit a boolean flips to inactive and every accessor checks it first, so a `ProjectSnapshot`, `ProjectFile`, symbol, or type carried out of the region fails with `SnapshotExpired` instead of returning stale answers. It is a soft guard on the accessors, not a hard invalidation of the handles. `src/Workspace/SnapshotRegion.ts`. Tested in `test/Workspace.test.ts` since `a2fdd6d`.

**WorkspaceSnapshot.** The region-scoped service: generation, list of configured projects, and `project(configured)` returning that project's view.

**ProjectSnapshot.** The type-checked view of one tsconfig project: root, path helpers, file access, symbol and type queries, and `unsafeNative` as the escape hatch to the raw compiler project. 568 lines in `src/Workspace/ProjectSnapshot.ts`, still the biggest file; about a third is path canonicalization.

**ProjectFile.** A `ProjectSnapshot` pre-bound to one validated project-relative path.

**Query.** A stream of `Selection`s (node plus accumulated evidence) from a project. Sources: `nodes`, `calls`, `imports`, `identifiers`, `referencesTo`. Operators: `where` (takes a `Criterion`, batches it, appends an evidence record), `filter` (plain predicate, appends nothing), `within`, `collect`. Semantic criteria: `resolvesTo`, `typeAssignableTo`. `src/Query/`.

**Draft.** What a recipe returns. `src/Draft/Draft.ts`:

| field            | meaning                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `edits`          | array of `TextEdit`: projectId, fileName, start, end, newText, sha256 of the original text in that range, evidence ids |
| `fileOperations` | create (with content), delete (with initial hash), move (with initial hash, optional content)                          |
| `evidence`       | records `{id, kind, facts}` explaining why each edit exists                                                            |
| `matches`        | number of selected targets, not number of edits                                                                        |

Edits are derived from AST nodes inside `unsafeNative` via `getStart`/`getEnd`. `replaceEach(selections, fn)` is the main authoring call; the callback returns a string, a `{node, text}`, or a whole Draft to adopt. `concat` merges drafts and rejects evidence records with the same id but different facts. `Draft.files.move` now moves a file with its content unchanged; it no longer rewrites importers. Nothing is ordered or conflict-checked at this stage.

**Plan.** The Draft frozen into a serializable, content-addressed artifact. `src/Plan.ts`, types derived from the schema since `6358736`. Adds recipe identity (name, version, implementation hash, options), toolchain versions, project list, a `SourceFingerprint` for every owned source file plus the root tsconfig, `snapshotHash`, `planId`, and the policies. The plan file must round-trip byte-exactly through canonical JSON.

**VirtualFs.** `VirtualFsSnapshot` is three collections keyed by absolute path: `files` (path to new content), `created`, `deleted`. `src/VirtualFs.ts` turns operations plus edits into that state; `Workspace/internal/CompilerOverlay.ts` wraps the compiler's filesystem callbacks so virtual content wins. Used only by verification now.

**Policy.** A `PlanPolicies` record on the plan with four fields: `matchCount` `{min?, max?}`, `maxAffectedFiles?`, `diagnostics` (`"no-new-errors"` or `"allow-new-errors"`), `idempotence` (`"required"` or `"not-promised"`). `src/Policy.ts` is 48 lines: two constructors (`matches`, `idempotent`) and `all`, which folds a list of partial policies into the record. Custom rule closures are gone.

**VerifiedPlan.** The plan, its preview, and its diagnostic diff, branded with a module-local symbol and a WeakSet so only `verify` can produce one. `src/Verification/VerifiedPlan.ts`.

## 3. The pipeline, step by step

### 3.1 run: recipe to Plan (`src/Recipe.ts`)

1. Validate and canonically encode the recipe input against its schema.
2. Open a snapshot region (`Workspace.withSnapshot`). All regions are serialized behind a semaphore.
3. Call `recipe.run(input)`, which returns a Draft.
4. `finalizeDraftEvidence` (`src/Evidence.ts`): merge evidence, then back-fill a `draft-operation` record for any evidence id an edit references but no record supplies. **(verified)** This silently invents justification for unjustified edits. It should fail.
5. `fingerprintWorkspace`: sha256 the root tsconfig and every owned source file. Only the root config is hashed, so `extends` chains and `paths` in a base config are invisible to freshness.
6. `finalizePlan` (`src/Plan.ts`): canonically order edits and operations, reject overlaps, compute hashes, stamp `TOOLCHAIN`.

`TOOLCHAIN` (`Recipe.ts:172`) **(verified)** has all three versions as string literals. Verify compares them byte for byte, so a dependency bump that does not edit this file makes every old plan fail with `ToolchainMismatch`.

### 3.2 verify: Plan to VerifiedPlan (`src/Verification/Verify.ts`) **(verified)**

In order, first failure wins:

1. Decode and structurally validate the plan, including byte-exact canonical JSON.
2. Plan project ids and config paths must equal the live workspace definition.
3. Recipe name, version, implementation hash must match; then canonical input JSON; then policies; then toolchain.
4. **Preview**: re-read every fingerprinted source from disk, fail `StalePlanError` on any hash mismatch, replay operations and edits in the virtual filesystem, produce before/after text and hash per file. Never writes.
5. Fire the `onPreview` callback.
6. Collect diagnostics from a fresh isolated compiler over an empty overlay (baseline).
7. Collect diagnostics from a fresh isolated compiler over the plan's overlay (proposed). If idempotence is required, also re-run the recipe inside that overlay and count what it would still change.
8. `computeDiagnosticDiff(baseline, proposed)` (`PolicyEvaluation.ts`): multiset diff keyed on `diagnosticIdentity`.
9. `evaluateBuiltInPolicies`: matchCount, then maxAffectedFiles, then diagnostics, then idempotence.
10. Issue the VerifiedPlan.

### 3.3 apply: VerifiedPlan to disk (`src/Application.ts`) **(verified)**

1. Reject anything not branded by `verify`.
2. Re-check project identity.
3. Preflight loop: for every previewed file, resolve a safe absolute target (symlink-escape checks), assert existence matches `before.exists`, assert sha256 matches `before.hash`.
4. Write loop: per file, write to a temp file with `wx` then rename, or delete.

The comment at `Application.ts:136` says "atomic". It is atomic per file only. A failure on file three of five leaves the first two written with no rollback and no journal. There is also a window between preflight and rename where another writer's change is clobbered.

## 4. Module map

Layer order is enforced by `tools/check-boundaries.mjs`. Keep it. Dead exports are enforced by `knip` in `pnpm lint` since `ed73f92`.

| layer | file(s)          | lines | one-line purpose                                         | state                                                               |
| ----- | ---------------- | ----: | -------------------------------------------------------- | ------------------------------------------------------------------- |
| 0     | `Edit.ts`        |   126 | TextEdit, hash guard, overlap rules, right-to-left apply | solid; uses `localeCompare` (section 6.3)                           |
| 0     | `Evidence.ts`    |    84 | evidence records, canonical JSON, finalize               | fix silent back-fill; uses `localeCompare`                          |
| 0     | `Plan.ts`        |   350 | the durable artifact, codec, validation, finalize        | types from schema; validate = re-finalize and compare               |
| 0     | `Policy.ts`      |    48 | four-field policy record and constructors                | `all` still last-write-wins (section 5)                             |
| 0     | `ProjectPath.ts` |   109 | portable relative paths, traversal defence               | security boundary; `caseInsensitive` option folds whole path        |
| 0     | `VirtualFs.ts`   |   170 | operations + edits to overlay state                      | no direct tests                                                     |
| 1     | `Workspace/`     |  1028 | compiler lifecycle, snapshots, overlay                   | overlay missing `directoryExists`/`realpath`; path code hand-rolled |
| 1     | `Query/`         |   548 | stream nodes with evidence                               | small and coherent                                                  |
| 2     | `Draft/`         |   433 | edits from nodes; create/delete/move files               | small now that imports/symbols are gone                             |
| 3     | `Recipe.ts`      |   231 | define, fingerprint, run                                 | hardcoded toolchain; root-config-only fingerprint                   |
| 3     | `Verification/`  |   733 | verify pipeline, preview, diagnostic diff, VerifiedPlan  | diagnostic identity includes position (section 6.3)                 |
| 3     | `Application.ts` |   165 | apply with path safety                                   | not atomic across files                                             |
| 4     | `Node.ts`        |    45 | real fs/path wiring                                      | every callback swallows errors to `undefined`, documented at `:15`  |

Tests live flat in `test/` with helpers in `test/utils/`. `test/utils/execute-recipe.ts` is the run+verify+apply composite that used to be the `Execution` module.

## 5. Policy: what can honestly be promised

**Promisable now.**

- `matchCount` min/max: the recipe counted selections. Honest.
- `maxAffectedFiles`: counted from the preview. Honest.
- `diagnostics: "no-new-errors"`, once identity stops including byte offsets: "the set of (file, code, message) errors did not grow". Honest and the single most valuable promise in the tool.

**Not promisable as built.**

- `idempotence: "required"`: re-runs the recipe inside the verification overlay and counts changes. Real, but doubles cost, and the overlay has the `directoryExists` gap, so a create-heavy recipe will falsely fail. Fix the overlay first.
- `Policy.all` **(verified)**: last write wins for every field. `all([matches({min: 1}), matches({max: 5})])` happens to merge because min and max are separate keys, but `all([matches({max: 1}), matches({max: 5})])` yields `max: 5`, and a later `diagnostics` value overrides an earlier one. Since `RecipeDefinition.policies` is still a `ReadonlyArray<Policy>`, this is the only way policies get onto a recipe. Recommendation: make `policies` a single `Partial<PlanPolicies>` and delete `all`, `matches`, and `idempotent`. About fifteen lines of types, zero lines of algebra.

## 6. The compiler seam

Before deciding how to fix path and reference handling, the question is what the compiler _exposes_. Checked against `node_modules/typescript/package.json` and `dist/api/async/api.d.ts` **(verified at 021b56e; re-check on any typescript bump)**.

**tsgo 7.0.2 exposes:** projects, programs, source files, all diagnostic getters, a checker with symbol-at-location (batched), references-to-symbol-in-file, `getReferencedSymbolsForNode`, `resolveName`, aliased symbols, module exports, type assignability, a printer, AST navigation and scanner utilities, and a filesystem callback interface with `fileExists`, `directoryExists`, `getAccessibleEntries`, `readFile`, `realpath`.

**tsgo 7.0.2 does not expose:** module resolution, any rename or find-all-references service, `getEditsForFileRename`, `useCaseSensitiveFileNames` on the API class, or the internal path utilities.

### 6.1 Replace with the compiler now

| where                                   | today                                                         | replace with                                                                                            |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Workspace/internal/CompilerOverlay.ts` | overrides fileExists, readFile, getAccessibleEntries only     | add `directoryExists` and `realpath`; `WorkspaceRuntime` already has both. Unblocks honest idempotence. |
| `Workspace/ProjectSnapshot.ts`          | hand-harvested import/export clauses for reference candidates | `getReferencedSymbolsForNode`                                                                           |
| `Recipe.ts` `fingerprintWorkspace`      | hashes root tsconfig only                                     | hash the parsed config (`API.parseConfigFile` output) so `extends` and `paths` count                    |

### 6.2 The compiler cannot help: one host, tested against a real disk

Path case folding and path containment are forced to be hand-rolled. Today they live in `ProjectSnapshot.ts:152-198` (hardcoded `caseInsensitive: true`, `toLowerCase()` on whole paths) and `ProjectPath.ts:72-74`. The Draft-side specifier code that used to duplicate them is deleted.

Recommendation: one internal module that owns exactly these primitives:

- `caseSensitive: boolean`, probed once at startup by creating a temp file and stat-ing its case-flipped name.
- `canonical(path)`: realpath where the file exists, ASCII-only case fold when insensitive, never `toLowerCase` on Unicode.
- `contains(root, path)` and `relative(root, path)` built on `canonical`.

Module specifier resolution is deliberately out of the core now. When `files.move` learns to rewrite importers again, it should do so through this host, rewrite relative specifiers only, and fail loudly on aliases it cannot resolve. A tool that refuses is safe; a tool that guesses is not.

### 6.3 Domain logic that is wrongly specified

- **Diagnostic identity** `Verification/PolicyEvaluation.ts:5-13` **(verified)**: includes `start` and `length`. A plan that inserts one line above an existing error moves it, and the diff reports one resolved and one introduced, so `no-new-errors` fails on a change that introduced nothing. Drop position from the diff key. Keep it for the separate cross-project dedup in `Verification/Diagnostics.ts`, which needs position. Two call sites, two keys. `test/VerificationPolicies.test.ts:100` currently asserts the wrong behaviour ("treats a diagnostic category or span change as a real transition"); that test flips.
- **Plan identity uses `localeCompare`** **(verified)**: `Evidence.ts:21`, `Edit.ts:49-53`, and the plan comparators (fixed in `src/Plan.ts`, which now uses code-point order). `localeCompare` is ICU and locale dependent. `planId` and `snapshotHash` are sha256 over that ordering, and `parsePlan` requires byte-exact canonical JSON, so a plan written on one machine can fail to parse on another. Replace with plain code-point comparison (`Order.string` from Effect) everywhere. This is the most important open bug.
- **Evidence back-fill** `Evidence.ts:76-82` **(verified)**: invents records for dangling ids. Should fail with a typed error.

## 7. Tests: what the suite protects

The mutant results below were taken at `021b56e`, before the suite was cut and moved. Re-run them before trusting them; some of the tests they refer to were deleted as tautological.

- `Plan.ts` "create path already exists" guard: now covered by the "create over an existing source" case.
- `computeDiagnosticDiff` duplicate cap: `test/VerificationPolicies.test.ts` now calls the real function (`:18`), so this may be covered. Confirm.
- `Query/Operators.ts` `within` project-id check: dropping it kept the suite green.
- `CompilerOverlay`: no test exercises it with a real compiler, so the `directoryExists` gap cannot be seen.

Four tests to write first, each asserting a contract from section 3 and not the implementation:

1. `Plan`: a create op whose path is already in sources is rejected by `validatePlan`.
2. `Policy`: a diagnostic whose position shifts but whose (file, code, message) is unchanged counts as unchanged.
3. `Workspace` overlay with a real compiler: a file created in a new virtual directory resolves from a NodeNext import.
4. `Plan` round trip under `LANG=C` and under a different locale produces identical bytes and ids.

## 8. Rules for agents, and what enforces them

Already in place: `tools/check-boundaries.mjs` for layering, `knip` for dead exports, the custom oxlint rule set under `tools/oxlint/anti-slop/`. New rules go there. Candidates, in order of value:

**Lint rules (oxlint, mechanical).**

- `no-path-case-folding`: flag `.toLowerCase()`/`.toUpperCase()` on any identifier or property matching `/path|file|dir|root/i`. Today this fires on `ProjectSnapshot.ts` and `ProjectPath.ts` and nothing else, which is the point.
- `no-node-path-outside-host`: only the host module and `Node.ts` may import `node:path` or `node:fs`.
- `no-throw-in-effect`: no `throw` inside a function returning `Effect` or inside `Effect.gen`.
- `no-overclaiming-comment`: doc comments on exports containing always, every, immutable, total, never, guaranteed must carry a `PROOF:` pointer to a test. Would catch `Application.ts:136`.

**Scripts in `tools/`.**

- `check-version-literals`: no semver string literal outside `package.json`. Would catch `Recipe.ts:172`.
- `check-test-hygiene`: flag `toHaveLength(n)` with no identity assertion in the same block; flag `Foo.test.ts` that never imports the module it names.

**Instructions for CLAUDE.md, in these words.**

- A test's expected value is a literal or a fixture, never a recomputation using the code under test's algorithm.
- Before adding an export, grep for an existing one. A new export needs two real call sites or a boundary test by the end of the task, or it is inlined.
- Every PR holds source line count flat or reduces it. New modules require the owner's explicit decision.
- Nothing from `RETIRED-CANDIDATES.md` comes back until section 6.3 is closed.

## 9. Order of work

Done: the deletion pass (`d7ae881` through `c3c1813`), `knip` in `pnpm lint`, flat `test/`, schema-derived plan types.

1. Fix `localeCompare` everywhere with `Order.string`. Add the locale round-trip test. Commit.
2. Fix diagnostic identity, flip the span-change test. Commit.
3. Make evidence back-fill fail. Commit.
4. Replace `RecipeDefinition.policies` array and `Policy.all` with one partial record. Commit.
5. Add `directoryExists`/`realpath` to the overlay, add the real-compiler overlay test. Commit.
6. Hash the parsed tsconfig, not the root file. Read `TOOLCHAIN` versions from `package.json` at build time or drop `effectVersion`. Commit.
7. Build the host module; move the two path normalizers into it; add the case-sensitivity probe; forbid `node:path` elsewhere. This is the largest step and the one to do by hand.
8. Decide whether apply should journal across files or state plainly that it is per-file atomic. Either is honest; the current comment is not.
9. Only now write the README, from sections 1 and 5, in your own words, and decide which retired candidates earn their way back.
