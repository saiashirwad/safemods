# safemods: reading guide for reclaiming the codebase

Working document, 2026-09-08. Written from the code at commit `021b56e`, the audit in `../safemods-audit`, and four independent module reviews. Nothing here is shipped documentation. Replace it with your own spec as you read; delete sections as they stop being news.

Claims marked **(verified)** were checked by hand against source or `node_modules`. Everything else is from reading and should be re-checked as you reach that file.

> **Status 2026-09-08, after cleanup commits b0fb461..817633b:** Cli, bin, examples, Overlay, Recipe combinators (pipe/all/branch/when), Execution, Query/Relations, Pattern ControlFlow and typed, the unused Query criteria, and imports.updateSource are removed. Tests now live in test/ with helpers in test/utils/. The module table in section 4 predates this and lists some modules that no longer exist.

---

## 1. The one idea

A codemod is not a script that edits files. It is a **durable, re-verifiable plan**.

```
recipe  ──run──▶  Draft  ──finalize──▶  Plan  ──verify──▶  VerifiedPlan  ──apply──▶  disk
        (compiler          (edits +         (content-       (preview +          (temp file +
         snapshot)          evidence)         addressed)      diag diff)          rename)
```

Every arrow is a boundary where the previous artifact is checked, never trusted. That is what makes it "safe". Everything else in the repo is either vocabulary for these five stages or a helper for writing recipes.

## 2. Vocabulary

**Native compiler handle.** A live TypeScript 7 (`tsgo`) process reached through `typescript/unstable/async`. It is opened with `acquireRelease`, so it closes with its Effect scope. `src/Workspace/internal/NativeCompiler.ts`.

**Snapshot.** One frozen state of that compiler's view of the world, ob
tained by `api.updateSnapshot(...)`, optionally with lists of changed, created, and deleted files. It has a numeric generation.

**Snapshot region.** The Effect scope inside which a snapshot may be used. On exit a boolean flips to inactive. Every accessor checks it first, so a `ProjectSnapshot`, `ProjectFile`, symbol, or type carried out of the region fails with `SnapshotExpired` instead of returning stale answers. It is a soft guard on the accessors, not a hard invalidation of the handles. `src/Workspace/SnapshotRegion.ts`.

**WorkspaceSnapshot.** The region-scoped service: generation, list of configured projects, and `project(configured)` returning that project's view.

**ProjectSnapshot.** The type-checked view of one tsconfig project: root directory, path helpers, file access, symbol and type queries, a printer, and `unsafeNative` as the escape hatch to the raw compiler project. 609 lines in `src/Workspace/ProjectSnapshot.ts`, the biggest file in the repo; about a third is path canonicalization.

**ProjectFile.** A `ProjectSnapshot` pre-bound to one validated project-relative path.

**Draft.** What a recipe returns. `src/Draft/Draft.ts`:

| field            | meaning                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `edits`          | array of `TextEdit`: projectId, fileName, start, end, newText, sha256 of the original text in that range, evidence ids |
| `fileOperations` | create (with content), delete (with initial hash), move (with initial hash, optional content)                          |
| `evidence`       | records `{id, kind, facts}` explaining why each edit exists                                                            |
| `matches`        | number of selected targets, not number of edits                                                                        |

Edits are derived from AST nodes inside `unsafeNative` via `getStart`/`getEnd`. `replaceEach(selections, fn)` is the main authoring call: the callback returns a string, a `{node, text}`, or a whole Draft to adopt. `concat` merges drafts and rejects evidence records with the same id but different facts. Nothing is ordered or conflict-checked at this stage.

**Plan.** The Draft frozen into a serializable, content-addressed artifact. `src/Plan/TransformationPlan.ts`. Adds: recipe identity (name, version, implementation hash, options), toolchain versions, project list, a `SourceFingerprint` (sha256) for every owned source file, `snapshotHash` over projects and sources, `planId` over everything, and the policies. The plan file must round-trip byte-exactly through canonical JSON.

**Overlay.** A way to run the compiler against files that do not exist on disk yet. A `VirtualFsSnapshot` is three collections keyed by absolute path: `files` (path to new content), `created`, `deleted`. `CompilerOverlay` wraps the compiler's filesystem callbacks so virtual content wins, deleted paths report absent, and created files appear in directory listings. It is used for verification (does the plan type-check) and for `Recipe.pipe` (let recipe B see recipe A's output). `src/VirtualFs/VirtualFs.ts` is the single state machine that turns operations plus edits into an overlay. `src/Overlay/Rebase.ts` collapses two drafts in different coordinate systems into one by diffing prefix and suffix.

**Policy.** Declarative acceptance criteria stored on the plan (match count bounds, max affected files, `no-new-errors`, idempotence) plus runtime `rules` closures. `src/Policy/Policy.ts`.

**VerifiedPlan.** The plan, its preview, and its diagnostic diff, branded with a module-local symbol and a WeakSet so only `verify` can produce one. `src/Verification/VerifiedPlan.ts`.

## 3. The pipeline, step by step

### 3.1 run: recipe to Plan (`src/Recipe/Run.ts`)

1. Validate and canonically encode the recipe input against its schema.
2. Open a snapshot region (`Workspace.withSnapshot`). All regions are serialized behind a semaphore.
3. Call `recipe.run(input)`, which returns a Draft.
4. `finalizeDraftEvidence`: merge evidence; back-fill placeholder records for any evidence id an edit references but no record supplies. (This silently invents justification for unjustified edits, which defeats the point of evidence. `src/Evidence/Finalize.ts:58`.)
5. `fingerprintWorkspace`: sha256 the root tsconfig and every owned source file. Only the root config is hashed, so `extends` chains and `paths` in a base config are invisible to freshness. `src/Recipe/Fingerprint.ts:66`.
6. `finalizePlan`: canonically order edits and operations, reject overlaps, compute hashes, stamp `TOOLCHAIN`.

`TOOLCHAIN` has two of three versions hardcoded as string literals (`Run.ts:19`). Verify compares them byte for byte, so a dependency bump that does not edit this file makes every old plan fail with `ToolchainMismatch`.

### 3.2 verify: Plan to VerifiedPlan (`src/Verification/Verify.ts`) **(verified)**

In order, first failure wins:

1. Decode and structurally validate the plan, including byte-exact canonical JSON.
2. Plan project ids and config paths must equal the live workspace definition.
3. Recipe name, version, implementation hash must match; then canonical input JSON; then policies; then toolchain.
4. **Preview**: re-read every fingerprinted source from disk, fail `StalePlanError` on any hash mismatch, replay operations and edits in the virtual filesystem, produce before/after text and hash per file. Never writes.
5. Fire the `onPreview` callback.
6. Collect diagnostics from a fresh isolated compiler over an empty overlay (baseline).
7. Collect diagnostics from a fresh isolated compiler over the plan's overlay (proposed). If idempotence is required, also re-run the recipe inside that overlay and count what it would still change.
8. `computeDiagnosticDiff(baseline, proposed)`: multiset diff keyed on `diagnosticIdentity`, which includes start and length.
9. Built-in policies: matchCount, then maxAffectedFiles, then diagnostics, then idempotence.
10. Custom rules in declaration order. Every custom failure is labelled `policy: "diagnostics"` regardless of what it checked.
11. Issue the VerifiedPlan.

### 3.3 apply: VerifiedPlan to disk (`src/Application/internal/Transaction.ts`) **(verified)**

1. Reject anything not branded by `verify`.
2. Re-check project identity.
3. Preflight loop: for every previewed file, resolve a safe absolute target (symlink-escape checks in `PathSafety.ts`), assert existence matches `before.exists`, assert sha256 matches `before.hash`.
4. Write loop: per file, write to a temp file then rename, or delete.

The comment says "atomic". It is atomic per file only. A failure on file three of five leaves the first two written with no rollback and no journal. There is also a window between preflight and rename where another writer's change is clobbered.

## 4. Module map

Layer order is enforced by `tools/check-boundaries.mjs`, which is the best engineering discipline in the repo. Keep it. Read bottom to top.

| layer | module         | lines | own tests | one-line purpose                                         | verdict                                                                          |
| ----- | -------------- | ----: | --------: | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0     | Edit           |   134 |        56 | TextEdit, hash guard, overlap rules, right-to-left apply | keep, all of it                                                                  |
| 0     | Evidence       |    97 |        51 | evidence records, canonical JSON                         | keep; fix silent back-fill                                                       |
| 0     | Plan           |   642 |       204 | the durable artifact, codec, validation                  | keep; ~20 dead exports, error reasons collapsed                                  |
| 0     | Policy         |   201 |     **0** | acceptance criteria and diagnostic diff                  | shrink hard, see section 5                                                       |
| 0     | ProjectPath    |   156 |        65 | portable relative paths, traversal defence               | keep, security boundary                                                          |
| 0     | VirtualFs      |   181 |     **0** | operations + edits to overlay state                      | keep; needs its own tests                                                        |
| 1     | Workspace      |  1115 |       386 | compiler lifecycle, snapshots, overlay                   | keep; split ProjectSnapshot, fix path code                                       |
| 1     | Query          |  1059 |      1122 | stream nodes with evidence, criteria                     | delete Relations.ts (369 lines, test-only), 3 unused semantic criteria           |
| 1     | Pattern        |   520 |       131 | node predicates producing facts                          | keep Pattern.ts + Expressions.ts; ControlFlow/Declarations are test-only breadth |
| 2     | Draft          |  1223 |       622 | edits from nodes; imports/files/symbols helpers          | most bugs live here; `updateSource` has zero callers                             |
| 2     | Overlay        |   411 |       582 | run a program over a draft's output; rebase drafts       | keep; Compose.ts can fold into Rebase                                            |
| 3     | Recipe         |   518 |       510 | define, run, pipe/all/branch/when                        | keep; overload ladders, hardcoded toolchain                                      |
| 3     | Verification   |   805 |       675 | verify pipeline, preview, VerifiedPlan                   | keep; `PolicyResult` never read                                                  |
| 3     | Application    |   197 |       191 | apply with path safety                                   | keep; not atomic across files                                                    |
| 3     | Execution      |    17 |        39 | run+verify+apply for tests                               | delete; not in package exports, only tests use it                                |
| 4     | Node, platform |    84 |       315 | real fs/path wiring                                      | keep; every callback swallows errors to `undefined`                              |
| 5     | Cli, bin       |   604 |     **0** | run/scan commands                                        | throw away until core is clean                                                   |

Total dead or test-only surface identified: roughly 1,100 lines of source and 800 lines of tests before touching any behaviour.

## 5. Policy: what can honestly be promised

The module has eight one-line combinators over an object literal, a diff engine, and `all()`.

**Promisable now, cheaply.**

- `matchCount` min/max: the recipe counted selections. Honest.
- `maxAffectedFiles`: counted from the preview. Honest.
- `noNewErrors`, once identity stops including byte offsets: "the set of (file, code, message) errors did not grow". Honest and the single most valuable promise in the tool.
- `allowErrors(code, max)`: a budget over introduced errors. Honest.
- `fixesError(code)`: "at least one error with this code disappeared". Honest but weak; it does not say the _target_ error disappeared.

**Not promisable as currently built.**

- `idempotent`: it re-runs the recipe inside the verification overlay and counts changes. That is a real check, but it doubles cost and the overlay itself has the `directoryExists` gap, so a create-heavy recipe will falsely fail. Keep the concept, fix the overlay first.
- `all()` **(verified)**: last write wins for every scalar field. `all([exactly(1), matches({max: 5})])` yields `max: 5`. A later `allow-new-errors` overrides an earlier `noNewErrors`. Delete it. A recipe should take one `policies` object, not a list to be "combined".
- Custom `rules` closures: they are not serialized into the plan, so a plan verified with rules A can be re-verified with rules B and nobody can tell. Either drop closures or hash their source into the plan.

Recommended shape after cleanup: one `PlanPolicies` record on the plan, four built-in checks, no combinator algebra, no closures. Ten lines of types, sixty lines of evaluation, one test file that calls `computeDiagnosticDiff` with real duplicated diagnostics.

## 6. The compiler seam

The bug shape the audit found: hand-written heuristics for things the compiler knows. Before deciding what to do, the question is what the compiler _exposes_. This was checked against `node_modules/typescript/package.json` and `dist/api/async/api.d.ts` **(verified)**.

**tsgo 7.0.2 exposes:** projects, programs, source files, all diagnostic getters, a checker with symbol-at-location (batched), references-to-symbol-in-file, `getReferencedSymbolsForNode`, `resolveName`, aliased symbols, module exports, type assignability, a printer, AST navigation and scanner utilities, and a filesystem callback interface with `fileExists`, `directoryExists`, `getAccessibleEntries`, `readFile`, `realpath`.

**tsgo 7.0.2 does not expose:** module resolution (`resolveModuleName`, `resolvedModules`), any rename or find-all-references service, `getEditsForFileRename`, `useCaseSensitiveFileNames` (present in the wire protocol, absent from the API class), and the internal path utilities (`dist/api/path.js` exists but is not in package exports).

So "ask the compiler" is possible for symbols, references, types, diagnostics, and printing, and **not** possible for module specifiers, case sensitivity, or renames. That splits the fix into three groups.

### 6.1 Replace with the compiler now

| where                                   | today                                                                                     | replace with                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Workspace/internal/CompilerOverlay.ts` | overrides fileExists, readFile, getAccessibleEntries                                      | add `directoryExists` and `realpath`; `WorkspaceRuntime` already has both. Fixes three audit "broken" rows. |
| `Draft/Symbols.ts:181-198`              | preserved-name filter by identifier text                                                  | compare symbol identity from the checker; the selections already came from `referencesTo`                   |
| `Workspace/ProjectSnapshot.ts:315-410`  | hand-harvested import/export clauses to find reference candidates                         | `getReferencedSymbolsForNode`                                                                               |
| `Pattern/Pattern.ts:7`                  | `SyntaxKind[kind]!` reverse map                                                           | `formatSyntaxKind` from `typescript/unstable/ast/utils`, and type the parameter as `SyntaxKind`             |
| `Recipe/Fingerprint.ts:66`              | hashes root tsconfig only                                                                 | hash the parsed config (`API.parseConfigFile` output) so `extends` and `paths` count                        |
| `Draft/Imports.ts:99, 198`              | quote style sniffed from one character; inserted import hardcodes `;\n` and double quotes | build the node with the factory and print it                                                                |

### 6.2 The compiler cannot help: build one Host, test it against a real disk

Path case folding, path containment, and module specifier resolution are forced to be hand-rolled in this version. Today they are spread across at least four near-duplicate normalizers in `ProjectSnapshot.ts:174-232`, `ProjectPath/Portable.ts`, `Draft/internal/ModuleSpecifiers.ts`, and `Draft/Files.ts`, with a hardcoded `caseInsensitive: true` and `toLowerCase()` on whole paths.

Recommendation: one internal module, call it the host, that owns exactly these primitives and nothing else:

- `caseSensitive: boolean`, probed once at startup by creating a temp file and stat-ing its case-flipped name.
- `canonical(path)`: realpath where the file exists, ASCII-only case fold when insensitive, never `toLowerCase` on Unicode.
- `contains(root, path)` and `relative(root, path)` built on `canonical`.
- `resolveSpecifier(fromFile, specifier)`: relative specifiers only, honouring the file's `impliedNodeFormat` from `getSourceFileMetadata` for extension rules. Return `undefined` for bare and aliased specifiers.

Then the honest scope statement: **safemods rewrites relative imports only. tsconfig `paths` aliases, package self-references, and `imports` maps are out of scope until the compiler exposes resolution.** Say that in the README and make `files.move` fail loudly, not silently, when it sees an alias it cannot rewrite. A tool that refuses is safe; a tool that guesses is not.

Everything else in `src/` is then forbidden from importing `node:path`, calling `toLowerCase` on a path, or touching a specifier string. That is lintable (section 8).

### 6.3 Domain logic that is wrongly specified

- **Diagnostic identity** `Policy.ts:12-20` **(verified)**: includes start and length. Drop them for the diff. Keep them for the separate cross-project dedup in `Verification/Diagnostics.ts:58`, which needs position. Two call sites, two keys.
- **Plan identity uses `localeCompare`** **(verified)**: `Evidence/Canonical.ts:7` sorts keys with `localeCompare`, and every comparator in `Plan/Validate.ts` and `Edit/Validate.ts` does too. `localeCompare` is ICU and locale dependent. `planId` and `snapshotHash` are sha256 over that ordering, and `parsePlan` requires byte-exact canonical JSON. A plan written on one machine can fail to parse on another with a different ICU build or locale. Replace with plain code-point comparison everywhere. This is the most important bug nobody has listed yet.
- **`addNamed` type-only guard** `Draft/Imports.ts:68` **(verified)**: returns an empty draft instead of falling through to insert a separate value import.
- **`removeNamed`**: deletes the whole statement when removing the last binding, dropping side-effect imports.
- **Evidence back-fill** `Evidence/Finalize.ts:58`: invents records for dangling ids. Should fail.

## 7. Tests: the actual gaps

The suite is green and protects little. Confirmed by re-running mutants against the full suite:

- `Plan/Validate.ts:83`: delete the "create path already exists" guard, suite stays green.
- `Policy.ts:73` cap duplicates at one, and `:133` swap resolved for introduced in `fixesError`: both survive, because `Verification/PolicyEvaluation.test.ts` hand-writes diff objects and never calls `computeDiagnosticDiff`.
- `Draft/Imports.ts:68` type-only guard replaced with `if (false)`: survives; the one test writes a file with no imports.
- `Query/Operators.ts:124` drop project-id check in `within`: survives.
- `Workspace/internal/CompilerOverlay.test.ts`: stubs every fs call, so the `directoryExists` gap cannot be seen.
- Cli: no test imports it.

Five tests to write first, each asserting a contract from section 3 and not the implementation:

1. `Plan`: a create op whose path is already in sources is rejected by `validatePlan`.
2. `Policy`: `computeDiagnosticDiff` with the same diagnostic twice in baseline: 2 to 2 is unchanged, 2 to 3 introduces one; and `fixesError` fails when the code is introduced rather than resolved.
3. `Draft.imports.addNamed` on a file with `import type { Foo } from "pkg"` yields a separate `import { Bar } from "pkg"`.
4. `Workspace` overlay with a real compiler: a file created in a new virtual directory resolves from a NodeNext import.
5. `Plan` round trip under `LANG=C` and under a different locale produces identical bytes and ids.

## 8. Rules for agents, and what enforces them

The repo already has a custom oxlint rule set under `tools/oxlint/anti-slop/` (no-unknown-returns, no-runtime-typeof, require-safety-comment-for-type-assertion, and others). New rules go there. Three tiers:

**Lint rules (oxlint, mechanical).**

- `no-path-case-folding`: flag `.toLowerCase()`/`.toUpperCase()` on any identifier or property matching `/path|file|dir|root/i`.
- `no-node-path-outside-host`: only the host module and `src/platform` may import `node:path` or `node:fs`.
- `no-throw-in-effect`: no `throw` inside a function returning `Effect` or inside `Effect.gen`. Catches `Overlay/Materialize.ts:54`.
- `no-passthrough-wrapper`: a function whose only statement is `return f(...sameArgs)` is deleted or re-exported.
- `no-overclaiming-comment`: doc comments on exports containing always, every, immutable, total, never, guaranteed must carry a `PROOF:` pointer to a test.
- `no-vacuous-every`: `expect(x.every(...))` in a test requires a non-empty length assertion on `x` in the same block.

**Scripts in `tools/`, same shape as `check-boundaries.mjs`.**

- `check-dead-exports`: every named export needs at least one non-test importer, or it is deleted. Run it in `pnpm check`. This is the mechanical answer to "how do I clean agentically": the script produces the list, an agent deletes what is on it, the boundary checker and typecheck confirm nothing broke.
- `check-version-literals`: no semver string literal outside `package.json` and `src/generated`.
- `check-test-hygiene`: flag `toHaveLength(n)` with no identity assertion in the same block; flag test doubles where every method returns a constant; flag `Foo.test.ts` that never imports `./Foo`.

**Instructions for CLAUDE.md, in these words.**

- Do not rewrite import or require specifier text with string or regex operations. Go through the host module. If the host returns undefined, fail with a typed error; never guess.
- A test's expected value is a literal or a fixture, never a recomputation using the code under test's algorithm.
- Before adding an export, grep for an existing one. A new export needs two real call sites or a boundary test by the end of the task, or it is inlined.
- Every PR holds source line count flat or reduces it. New modules require the owner's explicit decision.

## 9. Order of work

1. Delete: Execution, Query/Relations, unused Pattern guards, `imports.updateSource`, `hasJSDocTag`/`isExported`/`typeSatisfies`, `computeUnifiedDiff`, `PolicyResult`, the ~20 dead barrel exports, `Policy.all`. Park the Cli directory. Run `check`. Commit.
2. Add `check-dead-exports` and `check-version-literals` to `pnpm check` so step 1 cannot regress. Commit.
3. Fix `localeCompare` everywhere with one `Order.string`-style comparator. Add the locale round-trip test. Commit.
4. Fix diagnostic identity, add the diff test. Commit.
5. Add `directoryExists`/`realpath` to the overlay, add the real-compiler overlay test. Commit.
6. Fix `addNamed`, add its test. Commit.
7. Build the host module; move the four path normalizers into it; add the case-sensitivity probe; forbid `node:path` elsewhere. This is the largest step and the one to do by hand.
8. Only now write the README, from section 1 and section 5, in your own words.
