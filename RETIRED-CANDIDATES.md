# Retired candidates

Code with no production caller, inventoried before any deletion so the ideas survive the code. "No
production caller" means unreachable from `package.json` `exports` and from `bin/safemods.ts`; tests
and the two example recipes in `src/test/` count as exercise.

## 1. `src/Execution` (`executeRecipe`)

**What it does.** Three lines that run a recipe, verify the plan, apply it, and return all three
artifacts (`RecipeExecution.ts:10-16`).

**The idea.** The doc comment says why the three stages stay separable ("call the three stages
directly when a caller needs to stop between them", `:7-8`). The composite returns
`{ plan, verified, receipt }`, not just the receipt, so callers can assert on intermediate stages.

**API surface.** `executeRecipe(recipe, input)` via `src/Execution/index.ts:1`. **Exercised by** nine
test files (`src/PublicApi.test.ts:69,135`, `src/Draft/Cleanup.test.ts:36,50`,
`src/Node/Application/RaceSafety.test.ts:78`, `src/Execution/RecipeExecution.test.ts`, others), and it
is a named architecture layer in `tools/check-boundaries.mjs:12`. **To bring back:** trivial.

**Recommendation: keep.** Heavily used test infrastructure and the shortest honest answer to "how do
I use this library end to end". Its only real problem is its in-between status: either add
`./Execution` to `exports`, or move it into `src/test/`.

## 2. `src/Query/Relations.ts`

**What it does.** Four criteria that admit a node by its syntactic neighbourhood rather than its own
shape: `inside` walks ancestors (`:197`), `has` walks descendants (`:238`), and `precedes`/`follows`
scan siblings in one direction (`:296`, `:358-368`).

**Why relational matching matters.** Node kind is almost never the real predicate. The interesting
rules are "await inside a loop", "calls inside a function named `*Handler`", "a call that follows an
initialization statement", which is what issue #6 (closed; this file implements it) lists. Without
relations an author hand-rolls a parent walk inside `Query.filter` and loses the evidence trail:
relations record `ancestorKind`, `descendantKind`, or `siblingKind` facts (`:219`, `:268`, `:328`)
that reach plan evidence and the audit report, keeping matches explainable.

Two supporting ideas: `StopOptions.stopBy` (`:28-30`) is a scope fence stopping the walk at the
enclosing function, class, type, enum, module, or file (`isBoundaryNode`, `:95-109`), so "inside a
loop" cannot leak across a nested callback; and `RelationalMatcher` (`:36-39`) lets a relation take a
`Pattern`, a `Criterion`, or a bare predicate interchangeably (`evaluateMatcher`, `:51-93`).

**The two workarounds.** _Statement-shell retry_ (`:160-195`): relations are authored at statement
granularity ("this call follows `const initialized = ...`"), but `foo()` as a statement is an
`ExpressionStatement` wrapping a `CallExpression`, and the matcher targets the call. So a failed
direct match is retried through the candidate's inner expression for `ExpressionStatement`
(`:180-185`) and `ReturnStatement` (`:187-192`), reporting the inner node. It hides the
statement/expression mismatch so authors never write "the statement whose expression is a call".

_Positional sibling fallback_ (`:148`, also `:140-141`): sibling index is found by
`c === node || (c.pos === node.pos && c.end === node.end)`. Identity is the intended path; the range
comparison exists because TypeScript 7's async AST traversal can vend different object instances for
the same source range (`:111-118` says so). Without it, `precedes`/`follows` silently find no siblings
whenever the selection came from a different traversal than the parent walk. That compiler-API
observation is the most valuable thing in the file.

**API surface.** `Criterion.inside`, `.has`, `.precedes`, `.follows` (merged at `src/Query/index.ts:13`)
plus types `RelationalMatcher`, `SiblingOptions`, `StopOptions` (`src/Query/index.ts:8`). All shipped.
**Exercised by** `src/Query/Relations.test.ts` only: 560 lines covering the ancestor walk, both
`stopBy` modes, descendant search, both sibling directions, `immediately`, `Criterion.not`, and
overlay projects. **To bring back:** expensive; the retry and fallback would not be rediscovered
quickly.

**Issue #11 overlap.** #11 wants `Pattern.template("$arr.map($fn).flat()")` with metavariables, and
overlaps only in motivation (both cite ast-grep/GritQL, both replace hand-rolled filters).
Mechanically they are complementary: templates match within one expression tree by shape and
bindings, relations constrain the context a match sits in. A template would not subsume
`inside`/`follows`, and being a `Pattern` it could serve as a `RelationalMatcher` on arrival.

**Recommendation: keep.** Shipped public API, fully tested, implements a closed issue. The cheapest
cut, if one is needed, is the sibling half (`:119-195`, `:296-356`), which carries both workarounds
and the weakest use case; preserve the doc comments at `:111-118` and `:153-159` either way.

## 3. `src/Pattern/ControlFlow.ts` and `src/Pattern/Declarations.ts`

**What they do.** Node matchers for statement kinds: `loop` as a union over all five loop forms
(`ControlFlow.ts:40-63`), the five individual loop patterns (`:64-73`), `ifStatement` (`:78-94`),
`returnStatement` (`:98-115`), `functionDeclaration` (`Declarations.ts:31`), `classDeclaration` (`:64`),
`variableStatement` (`:92`).

**The option-bag design.** Every matcher takes an optional readonly options interface where each key
is independently optional and undefined means "don't care", so
`functionDeclaration({ name: /Handler$/, async: true, exported: true })` reads as a conjunction and
unspecified keys cost nothing. Three properties make it pay off. (1) Declarative narrowing:
`loop({ kind: "for-of" })` picks a guard from a lookup table (`ControlFlow.ts:33-39`) rather than
making the author import `isForOfStatement`. (2) Sub-pattern nesting:
`returnStatement({ expression: somePattern })` (`:95-114`) takes another `Pattern` as an option value
and recurses, so options are not just scalars, they are patterns; that is the seed of a compositional
matcher language. (3) Evidence by construction: success returns `matchSuccess(node, facts)` carrying
`loopKind`, `hasElse`, or the declaration name. `matchesExportModifier` (`Declarations.ts:18-24`)
keeps `exported` uniform across all three declaration forms.

**API surface.** All of the above plus six option interfaces, via `src/Pattern/index.ts:12-13`.
**Exercised by:** `functionDeclaration` has real use (`src/Recipe/RecipePolicy.test.ts:168`,
`src/Recipe/RecipeProjectFile.test.ts:94`); everything else only by `src/Query/Relations.test.ts`
(`loop` `:63,83,91,357,371,385,499`, the five loop patterns `:471-495`, `ifStatement` `:459`,
`returnStatement` `:465`, `variableStatement` `:233,243,257,302`, `classDeclaration`
`:356,370,384,453`). `LoopPatternOptions.kind` and `returnStatement`'s `expression` are never given a
value anywhere. **To bring back:** cheap, these are thin wrappers over
`typescript/unstable/ast/is` guards.

**Recommendation: keep the modules; the two uncovered options are the real candidates.** Deleting
these files guts the `Pattern` surface and takes `Relations.test.ts` with it. `LoopPatternOptions.kind`
duplicates the five individual loop patterns, and `returnStatement`'s `expression` is an orphan until
a second matcher nests sub-patterns. Both want a test rather than a deletion, since sub-pattern
nesting is where issue #11 points.

## 4. `src/Query/Semantic.ts`: `hasJSDocTag`, `isExported`, `typeSatisfies`

**What they do, and why.** `hasJSDocTag(tag)` (`:69-75`) admits nodes carrying a JSDoc tag,
normalizing a leading `@`; it is how a deprecation sweep is written. `isExported()` (`:87-93`) is the
"public API surface" filter, reading modifiers through a structural `"modifiers" in node` guard
(`:81-84`) so it spans every declaration kind without a union type. `typeSatisfies(id, pred)`
(`:162-174`) admits nodes whose computed type passes an arbitrary predicate over the `Type` and its
rendered string: the semantic layer's escape hatch to a raw checker predicate without leaving the
query algebra or losing evidence. All three ride `eachComputedType` (`:100-134`), the load-bearing
idea: selections are grouped by project and file and resolved through one batched `typesAt` call at
concurrency 8, so a criterion over 10,000 nodes is not 10,000 checker round trips.

**API surface.** Shipped via `src/Query/index.ts:9`. **Exercised by** tests only
(`src/Query/Semantic.test.ts:42-56`, `:67-72`, `:146-152`); siblings `resolvesTo` and
`typeAssignableTo` do have non-test users (`src/test/wrap-target-input.ts:37`,
`src/Pattern/Pattern.test.ts:69`), so the batching machinery stays regardless. **To bring back:** very
cheap.

**Recommendation: keep.** Three small, tested, useful public criteria in a library whose selling point
is a rich query vocabulary, and `typeSatisfies` is the extensibility valve.

## 5. `src/Query/Operators.ts`: `withArgCount`, `filter`

**What they do, and why.** `withArgCount(count)` (`:137-153`) filters a `Query<CallExpression>` by
argument count, taking an exact number or `{ min, max }`; it is the arity case common enough to
deserve a name. `filter(predicate)` (`:81-86`) is the generic escape hatch: any predicate over a
`Selection`, preserving accumulated evidence. Both use `Function.dual` so they work data-first and
data-last. The deeper point is the split between `where` (`:16-55`) and `filter`: `where` takes a
`Criterion`, batches it, and appends an evidence record explaining the match, while `filter` takes a
plain predicate and appends nothing (`:80` says so). The module deliberately offers a cheap
unexplainable filter beside the expensive explainable one.

**Exercised by.** Both example recipes call `filter` (`src/test/migrate-import-source.ts:29`,
`src/test/wrap-target-input.ts:38`), plus `src/Query/Operators.test.ts:153`. `withArgCount` is tested
(`Operators.test.ts:164-169`) and used at `src/Recipe/RecipePolicy.test.ts:210,227` and
`src/Query/Relations.test.ts:550-551`, but by no example recipe. **To bring back:** trivial.

**Recommendation: keep `filter`; keep `withArgCount` with lower confidence.** `filter` is not a
deletion candidate at all, since two of two example recipes call it. `withArgCount` is narrow but only
seventeen lines and the module's only ergonomic shorthand; if anything here is cut it is this.

## 6. `src/Draft/Imports.ts`: `imports.updateSource`

**What it does, and why.** Rewrites an import declaration's module specifier in place, returning
`Draft.empty` when it already equals the target (`:195`). The ideas are quote preservation by
observation rather than configuration (no printer, no formatting option, just
`specifier.getText(sourceFile)[0] ?? '"'` at `:198`) and the no-op-as-empty-draft convention that lets
`Policy.idempotent()` pass without special casing.

**API surface.** `Draft.imports.updateSource(project, declaration, newModule)`, shipped via
`src/Draft/index.ts`; **exercised by** nothing, with zero references outside `:186`.

**The awkward part.** `src/test/migrate-import-source.ts` is a recipe whose entire job is rewriting an
import source, and it does it by hand at `:36-40`, including an inline quote sniff at `:38` that
duplicates `updateSource` exactly. Either the recipe should call `updateSource`, or `updateSource` is
redundant with `replaceEach`; it should not stay as-is with the showcase recipe reimplementing its own
helper.

**To bring back:** trivial. **Recommendation: keep, but only if `migrate-import-source.ts` is
switched to use it.** Otherwise delete it, recording the quote-preservation trick as the idea worth
keeping.

## 7. `src/Draft/internal/ModuleSpecifiers.ts`: `specifierLiteral` breadth

**What it does.** `specifierLiteral(node)` (`:97-134`) answers "does this node carry a module specifier
literal, and which one" across six forms: `import ... from` (`:98`), `export ... from` (`:101`),
`import x = require("x")` (`:108`), dynamic `import("x")` and CJS `require("x")` sharing one branch
(`:120-124`), and `import("x").T` type nodes (`:126`).

**The idea.** `eachModuleSpecifier` (`:136-146`) walks the file calling one predicate, so file-move
specifier rewriting (`specifierReplacements`, `:154-182`) does not care what form a dependency edge
takes. Correctness depends on catching every form: miss `import type` and a type import dangles; miss
`require()` and a mixed CJS/ESM repo breaks silently. Getting the list right once, in one function, is
how this should be organized.

**API surface.** None; the file is `internal/` and only `src/Draft/Files.ts:18,140` consumes it.
**Exercised by.** `src/Draft/Files.test.ts:60-80` moves a file and asserts importer rewrites, but its
fixture uses plain `import { A } from "./lib.js"` only. No fixture anywhere contains
`import x = require(...)`, a dynamic `import()`, a bare `require()`, or `import type ... from`, so
four of six branches (`:108-114`, `:116-125`, `:126-132`) are uncovered. **To bring back:** cheap to
retype, easy to get subtly wrong, and the failure mode is a silently broken file move rather than a
test failure.

**Recommendation: keep, and add fixtures.** The right action is the opposite of deletion: one fixture
containing all six forms, turning aspirational breadth into verified breadth for thirty lines of test.
Deleting the branches would make `Draft.files.move` quietly incorrect on most real codebases.

## 8. `src/Verification/PolicyEvaluation.ts`: `PolicyResult` / `results`

**What it does, and why.** Both evaluators return `{ results, failure }` (`:33-36`); `results` is an
ordered array of `{ name, passed, detail? }`, one per applicable policy (`:49`, `:54`, `:64`, `:69`).
The idea is that a verification pass should report what it checked, not only whether it failed: the
array is built in established order (`:38`) with names taken from the policy itself and omits policies
that were not configured, so it is a faithful audit trail. That is what a `--verbose` verify output or
a machine-readable receipt would print.

**Exercised by.** `failure` is consumed by `src/Verification/Verify.ts:199,211`. `results` is read in
exactly three places, all assertions in its own test
(`src/Verification/PolicyEvaluation.test.ts:27,70,113`), and neither `PolicyResult` nor
`PolicyEvaluation` is exported from `src/Verification/index.ts`, so nothing outside the module could
read it. **To bring back:** trivial.

**Recommendation: keep as documented idea only, or wire it through.** As it stands this is the
"tautological tests considered harmful" case in pure form: a field computed only so a test can assert
its shape. Either surface `results` on `VerifiedPlan` and print it under `--verify` (what it was
clearly built for), or drop the field and its three assertions, keeping the note that a verification
receipt should carry a per-policy audit trail. Do not leave it computed and unread.

## 9. `src/Recipe/Combinators.ts`: overload ladders, `when`, policy arithmetic

**What it does.** `pipe` composes recipes sequentially through in-memory overlays (`:52-91`), `all`
runs them concurrently and merges drafts (`:94-120`), `branch` picks one of two by a snapshot predicate
(`:127-153`), `when` is `branch` against a synthesized no-op (`:156-173`).

**The overload ladders.** `pipe` declares two, three, and four argument overloads (`:52-66`) and `all`
two and three element tuple overloads (`:94-99`) before the variadic implementations, buying precise
error and requirement channel unions: the variadic signature alone would collapse every child to a
single `E`/`R`. Finite, though: five composed recipes falls off the end.

**`when`.** `when(predicate, recipe)` is `branch` with a fabricated identity recipe on the false side,
carrying `Policy.all([]).policy` and an `implementationHash` of
`sha256(recipe.implementationHash + ":noop")` (`:166,170`), so the composite's fingerprint still
changes with the wrapped recipe and the no-op is a real hashable participant, not a special case in
`run`. The idea worth keeping: conditional execution as composition with an identity element.

**The policy arithmetic (`:177-243`).** The most interesting design here. Composing recipes must
compose their safety policies, and the correct arithmetic depends on whether every child runs or only
one does (`ChildExecution`, `:182`). `composeMatchCount` (`:184-203`) sums minimums when all children
run but takes the minimum of minimums when only one does; maximums sum versus take the maximum, and
only when every child is bounded, otherwise the composite is unbounded (`:194`).
`composeMaxAffectedFiles` (`:205-219`) follows the same shape (`:211`). Idempotence is required if any
child requires it (`:229-232`), and diagnostics take the stricter setting if any child is strict
(`:233-237`). Every one is the conservative direction. The principle worth recording: composition must
never produce a policy weaker than its parts, and "which children execute" decides sum versus max.

**API surface.** `all`, `branch`, `pipe`, `when`, `SnapshotPredicate`, via `src/Recipe/index.ts:3-4`.
**Exercised by** tests only: `Recipe.pipe` throughout `src/Recipe/RecipePolicy.test.ts` and
`src/Recipe/RecipePipe.test.ts`; `all` and `branch` at
`RecipePolicy.test.ts:42-43,73-74,108,115,134,265`; `when` once at `RecipePolicy.test.ts:75`;
`RecipePolicy.test.ts:72-74,108-115` is the policy arithmetic test. **To bring back:** the combinators
are easy, the arithmetic is not. Sum-versus-max and unbounded propagation would be re-derived
incorrectly on a first attempt, and the bug would be a composite that silently permits more damage
than its parts allow.

**Recommendation: keep.** The algebraic core of the library (issue #3, closed), and the policy
arithmetic is a real contribution. `when` has one test as its sole exercise and is fourteen lines, so
it is defensible either way; if it goes, keep the identity-element idea.

## 10. `src/Cli` and `bin/safemods.ts`

**What it does.** Two commands over one runner. `safemods run <recipe>` loads a recipe module, runs
it, and prints a preview; `--verify` adds a diagnostic delta, `--apply` applies and prints a receipt
line (`src/Cli/Run.ts:113-174`, `bin/safemods.ts:26-44`). `safemods scan <recipe>` runs only the query
phase and prints an audit report, exiting non-zero on matches under `--fail-on-match`
(`bin/safemods.ts:46-64`, `src/Cli/Run.ts:132-150`).

**Ideas worth keeping.** _Recipe loading by duck-typing_ (`Run.ts:82-111`): a module is searched for a
recipe on `default`, then `recipe`, then any export, by a three-key shape check, so recipes stay plain
ES modules with no registration ceremony. _Exhaustive tagged error rendering_ (`Run.ts:49-61`):
`Match.typeTags<CliTaggedError, string>()` maps every domain error to a sentence, so adding an error to
the union is a compile error until the CLI has a message for it. _Failure as a typed value_
(`Audit.ts:47-50`, `bin/safemods.ts:70-74`): `CliMatchFoundError` carries `{ matches, files }` and
drives `--fail-on-match` CI gating instead of an ad hoc `process.exit`.

**The scan audit report.** `AuditReport` (`Audit.ts:37-45`) is
`{ recipe: { name, version }, totalMatches, totalFiles, findings }`, and each `AuditFinding` (`:23-35`)
carries id, projectId, fileName, byte `start`/`end`, one-based start and end line/column, a source
`snippet`, and the `{ criterion, facts }` records that admitted it. The interesting part is the
construction: findings are decoded out of the plan's evidence array with a schema (`:52-70`), never
re-queried, so the report is a pure projection of the plan plus line/column resolution (`:99-104`).
Findings sort into a canonical order (`:124-132`) and `totalFiles` is a set over `virtualFileKey`
(`:134-136`), so the report is deterministic and diffable. `renderAuditText` (`:150-206`) groups by
`projectId:fileName` and prints `line L:C [criterion, criterion]` per hit with up to three trimmed
snippet lines.

**Exercised by.** Nothing. No test file under `src/Cli`, no test imports it, and
`tools/package-smoke.mjs` only type-imports the `exports` entries, which exclude Cli. This is
user-facing shipped surface with zero automated coverage.

**Gap against issue #10.** The closed issue asked for structured JSON and CSV export. `AuditReport` is
fully structured and JSON-ready, but no flag emits it; only `renderAuditText` is wired up. That is the
highest-value unimplemented idea here. **To bring back:** moderate, since the evidence-to-findings
projection and canonical sort would take real thought to redo.

**Recommendation: keep.** A codemod toolkit without a CLI is a library, and `package.json` already
declares the `bin`. The real defect is not deadness but that a shipped binary has no test: one
integration test running `scan` against the project fixture would cover most of all three files.

## 11. `src/Cli/Diff.ts`: `computeUnifiedDiff`

**What it does, and why.** Renders a coloured unified diff for one file given a name and before/after
text, short-circuiting to a dim `(no changes)` line when they are equal (`:50-61`). It is the
file-level primitive that `renderFilePreview` is the plan-aware version of; both go through the
private `createUnifiedDiff` (`:36-48`), which pins `headerOptions` (`:15-19`: no index line, no
underline, keep file headers) so diffs are stable and git-like, and both use one line-prefix
colouriser (`:21-34`).

**Exercised by.** Nothing: zero references outside `:50`. `renderFilePreview` (`:63`) inlines the same
two branches at `:77-86` instead, because it needs `/dev/null` on the create and delete sides, which
`computeUnifiedDiff`'s fixed `a/` and `b/` naming cannot express. **To bring back:** trivial.

**Recommendation: delete outright.** The clearest cut here: an exported function with no caller, whose
one plausible caller deliberately avoids it because the signature does not fit. The useful parts
(`patchHeaderOptions`, `colorizePatch`, `createUnifiedDiff`) all stay, and the no-change short-circuit
is already duplicated at `:79`.

## 12. Dead barrel exports

Names exported from an `index.ts` with zero references outside their own module, verified by grepping
every exported name across `src`, `bin`, and `tools`. None of these five barrels ships in
`package.json` `exports`.

**`src/Edit/index.ts`**

- `TextReplacement` (`:2`): input type for `applyTextReplacements`; named only by `Apply.ts`.
- `compareEdits` (`:5`): edit ordering comparator; used only inside `Validate.ts`.
- `normalizeEdits` (`:5`): sort-and-validate pass over an edit list; used only inside `src/Edit`.

**`src/Evidence/index.ts`**

- `DraftEvidenceTarget` (`:3`): what a draft evidence record points at; internal to `Finalize.ts`.
- `MissingEvidence` (`:3`): error for a draft edit with no backing evidence; internal, but check
  whether it belongs in a public error union first.

**`src/Plan/index.ts`**

- `CreateFileOperation`, `DeleteFileOperation`, `MoveFileOperation` (`:13-15`): variants of the widely
  used `PlannedFileOperation`; consumers narrow with `Extract<..., {kind}>` instead
  (`src/Draft/Files.test.ts:9-18`), leaving the aliases unused.
- `PlanMeasurements` (`:17`): the `{ matches }` block; named only by `TransformationPlan.ts`.
- `ProjectEvidence` (`:18`): per-project evidence grouping; internal.
- `SourceFingerprintKind` (`:20`): discriminant of `SourceFingerprint`; internal.
- `TransformationPlanSchema` (`:23`): the Effect Schema for a plan. The one to think twice about: an
  external tool validating a serialized plan would want it.

**`src/ProjectPath/index.ts`**

- `isProjectRelativePath` (`:5`): boolean guard; callers use the `parse`/`require` variants.
- `PathContainmentOptions` (`:13`): options for `isPathContained`; internal.
- `PlanProjectPaths` (`:14`): plan-path resolution bundle; internal.
- `ResolvedPlanFilePath` (`:16`): return of `resolvePlanFilePath`; callers infer it.

**`src/VirtualFs/index.ts`**

- `VirtualFsMaterializeOptions` (`:5`): options for `materialize`; named only by `VirtualFs.ts`.

**Recommendation: delete the export lines, keep every definition.** These are barrel entries, not
code, and removing them makes each module's real interface legible at zero risk. Pause only on
`TransformationPlanSchema` (plausibly wants to become public instead) and `MissingEvidence`.
