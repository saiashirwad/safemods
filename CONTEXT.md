# Safemods

Safemods describes TypeScript project changes, proves them against a compiler view, and writes only changes that passed their declared checks.

## Language

**Configured Project**:
A stable identity and configuration path for one TypeScript project in a Workspace.
_Avoid_: Project config, tsconfig

**Workspace**:
The set of Configured Projects and the means to inspect them through controlled snapshots.
_Avoid_: Repository, filesystem

**Workspace Snapshot**:
A time-limited, immutable view of every Configured Project in a Workspace.
_Avoid_: Workspace, compiler session

**Project Snapshot**:
The checked view of one Configured Project within a Workspace Snapshot.
_Avoid_: Project, Workspace Snapshot

**Project File**:
A validated reference to an existing source file in one Project Snapshot.
_Avoid_: File path, source file

**Selection**:
An occurrence accepted by a Query, together with its snapshot, location, and the evidence for its inclusion.
_Avoid_: Match, node

**Query**:
A description of how to produce Selections from a Project Snapshot.
_Avoid_: Search, scan

**Pattern**:
A reusable structural shape that a Query can match against syntax.
_Avoid_: Query, predicate

**Recipe**:
A named, versioned transformation that accepts input and returns a Draft under declared policies.
_Avoid_: Codemod script, migration

**Draft**:
An immutable proposal containing edits, file operations, evidence, and a match count. A Draft has no write authority.
_Avoid_: Plan, patch

**Overlay**:
An in-memory project view containing proposed changes from an earlier Draft, used to compose later work without writing.
_Avoid_: Draft, temporary checkout

**Transformation Plan**:
A durable, content-addressed record of proposed changes, source observations, recipe identity, and policies.
_Avoid_: Draft, Verified Plan

**Policy**:
A constraint recorded in a Transformation Plan and evaluated during Verification.
_Avoid_: Verification Rule, precondition

**Verification Rule**:
A runtime check evaluated during Verification that cannot be represented only by the durable built-in Policy fields.
_Avoid_: Policy

**Verification**:
The read-only process that revalidates a Transformation Plan, compares compiler results, evaluates its policies, and may issue a Verified Plan.
_Avoid_: Preview, application

**Verified Plan**:
A process-local grant of authority issued by successful Verification and required by Application.
_Avoid_: Transformation Plan, verification result

**Application**:
The sole operation allowed to write the changes from a Verified Plan.
_Avoid_: Execution, apply mode

**Receipt**:
A record of completed Verification or Application and its observed result.
_Avoid_: Plan, result

**Evidence**:
Durable facts that explain why a Selection qualified or why proposed work exists.
_Avoid_: Log, diagnostic
