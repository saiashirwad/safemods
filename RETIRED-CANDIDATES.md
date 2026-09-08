# Retired

Code removed between `d7ae881` and `c3c1813` on 2026-09-08 so the core pipeline could be understood and owned. Each entry records what it was, the one idea worth keeping, and what has to be true before it comes back. Line references are to the commit that removed it; `git show <commit>` recovers the code.

None of this returns until the open bugs in `RECLAIM.md` section 6.3 are closed. When it does, it is rebuilt on the core primitives, not restored.

## Still in the tree, relocated

**`executeRecipe`** (`d88656e`). Run, verify, apply, return all three artifacts. Now `test/utils/execute-recipe.ts`. If a public one-shot entry is wanted later, this is its shape: return `{ plan, verified, receipt }`, never just the receipt, so callers can stop between stages.

## Removed in `c3c1813`: the codemod and sugar layers

**Pattern DSL** (`src/Pattern.ts`, `Query.match`). `bind`, `tuple`, `callExpression`, `functionDeclaration`, `identifier`: node predicates that produce evidence facts on success. Idea to keep: matchers return `matchSuccess(node, facts)` so evidence is a by-product of matching, not a separate step; and option bags where `undefined` means "don't care", so `functionDeclaration({ name: /Handler$/, async: true })` reads as a conjunction. Return condition: a real recipe needs more than `nodes` + `filter`/`where`. Issue #11 (template patterns with metavariables) is the direction if it comes back.

**Symbol rename** (`Draft/Symbols.ts`: `renameSymbol`, `renameSymbolNamed`). Rewrote every reference to a symbol via `referencesTo`. Known bug at removal: the preserved-name filter compared identifier text instead of checker symbol identity. Return condition: reimplement the filter on `canonicalSymbol`, and only after `getReferencedSymbolsForNode` replaces the hand-harvested reference candidates in `ProjectSnapshot`.

**Import editing** (`Draft/Imports.ts`: `imports.addNamed`, `removeNamed`). Known bugs at removal: `addNamed` returned an empty draft when the only existing import was type-only instead of inserting a separate value import; `removeNamed` deleted the whole statement when removing the last binding, dropping side-effect imports; inserted text hardcoded `;\n` and double quotes. Return condition: build the node with the compiler factory and print it, and write the type-only test first.

**Importer rewriting in `files.move`** (`Draft/internal/ModuleSpecifiers.ts`). `specifierLiteral` recognised six specifier-bearing forms (`import from`, `export from`, `import = require`, dynamic `import()`, `require()`, `import("x").T`); `files.move` rewrote every importer's relative specifier. Idea to keep: one function that enumerates every form, so a missed form is a one-line fix and not a silently broken move. Known gap at removal: four of the six forms had no fixture. Return condition: the host module from `RECLAIM.md` 6.2 exists, rewriting goes through it, relative specifiers only, and aliases fail loudly. `files.move` today moves content unchanged.

**Custom policy rules** (`Policy.diagnosticDiff`, `VerificationRule`, `allowErrors`, `noNewErrors`). Closures over the diagnostic diff evaluated after the built-in policies. Why they went: closures are not serialised into the plan, so a plan verified under rules A re-verifies under rules B and nobody can tell; every custom failure was labelled `policy: "diagnostics"`; `noNewErrors` was a no-op because the default already was. Idea to keep: `allowErrors(code, max)` as a budget over introduced errors is an honest, serialisable promise. Return condition: it is a field on `PlanPolicies`, not a closure.

**Query sugar** (`withArgCount`, `textMatches`). Both were `filter` with a name. Return when a second recipe wants them.

**`ProjectSnapshot.symbolAt`**. Lost its last caller with symbol rename.

## Removed earlier today

**CLI and `bin/safemods.ts`** (`546810a`). `run` with `--verify`/`--apply`, `scan` with `--fail-on-match`, and `Cli/Diff.ts`. Zero tests. Ideas to keep: recipe loading by duck-typing (`default`, then `recipe`, then any export with the three-key shape) so recipes are plain ES modules; `Match.typeTags` over the error union so a new domain error is a compile error until the CLI can render it; `AuditReport` decoded from plan evidence with a schema, never re-queried, sorted canonically so it is diffable. Return condition: the core is stable and the first command ships with an integration test against the project fixture. Issue #10 (JSON and CSV export of the audit report) is the highest-value unimplemented piece.

**Recipe combinators** (`e6970a1`: `pipe`, `all`, `branch`, `when`, `Overlay/`). Composed recipes through in-memory overlays. The part that was hard to get right and will be re-derived wrongly on a first attempt: policy arithmetic. When every child runs, match minimums and maximums sum; when one child runs, take the minimum of minimums and the maximum of maximums; a composite is unbounded if any child is; idempotence is required if any child requires it; diagnostics take the strictest child. Composition must never yield a policy weaker than its parts. `when` was `branch` against a synthesised no-op whose `implementationHash` derived from the wrapped recipe, so the identity element was a real hashable participant. `Overlay/Rebase.ts` collapsed two drafts in different coordinate systems by diffing prefix and suffix. Return condition: `Policy.all` is gone and policies are a single record, so the arithmetic has one shape to compose.

**Relational query criteria** (`a811132`: `Criterion.inside`, `has`, `precedes`, `follows`). Admit a node by its neighbourhood; `stopBy` fenced ancestor walks at the enclosing function, class, type, enum, module, or file. Two workarounds worth remembering: a failed statement-level match retried through the inner expression of `ExpressionStatement` and `ReturnStatement`; and sibling lookup fell back to `pos`/`end` range equality because TypeScript 7's async AST traversal can vend different object instances for the same source range. That compiler observation is the most valuable thing in the file. Implemented closed issue #6.

**Statement-kind patterns** (`06f8214`: `loop`, `ifStatement`, `returnStatement`, `classDeclaration`, `variableStatement`, `Pattern.typed`). Thin wrappers over `typescript/unstable/ast/is` guards with option bags. `returnStatement({ expression: somePattern })` was the one place a pattern nested inside another pattern's options; that is the seed of a compositional matcher language if #11 is pursued.

**Semantic criteria** (`8dcfa05`: `hasJSDocTag`, `isExported`, `typeSatisfies`). Test-only. `typeSatisfies(id, pred)` was the escape hatch to a raw checker predicate without leaving the query algebra. The batching underneath them (`eachComputedType`, one `typesAt` call per file at concurrency 8) stays in `Query/Semantic.ts` for `resolvesTo` and `typeAssignableTo`.

**`imports.updateSource`** (`8793ccd`). Zero callers; the showcase recipe reimplemented it inline. Idea to keep: quote style preserved by observation (`getText(sourceFile)[0]`), and no-op returns `Draft.empty` so idempotence needs no special case.

**`PolicyResult` / `results`** (`d7ae881`). A per-policy `{ name, passed, detail? }` audit trail computed on every verify and read only by its own test. Idea to keep: a verification receipt should say what it checked, not only whether it failed. Return condition: it is surfaced on `VerifiedPlan` and printed by something.

**`computeUnifiedDiff`** and dead barrel exports (`d7ae881`). Nothing to keep; `knip` now prevents the barrel case from recurring.
