import * as Fs from "node:fs/promises"
import * as Path from "node:path"
import { describe, effect, expect } from "@effect/vitest"
import { Crypto, Deferred, Effect, Fiber, FileSystem, Option, Path as PlatformPath } from "effect"
import * as Proposal from "../src/Proposal.ts"
import * as Query from "../src/Query.ts"
import * as Recipe from "../src/Recipe.ts"
import * as Migration from "../src/Migration/index.ts"
import { workspacePath } from "./utils/domain.ts"
import { executeRecipe } from "./utils/execute-recipe.ts"
import { exists, read, withFixture, write } from "./utils/fixture.ts"

const createFile = (fileName: string, content: string) =>
  Recipe.define(`create-${fileName}`, {
    version: "1.0.0",
    policies: { diagnostics: "allow-new-errors" },
    run: () => Effect.succeed(Proposal.createFile(workspacePath(fileName), content)),
  })

const verified = <E, R>(recipe: Recipe.Recipe<undefined, E, R>) =>
  Migration.verify(recipe, undefined)

const withFaultyFileSystem = (use: (fs: FileSystem.FileSystem) => FileSystem.FileSystem) =>
  Effect.provideServiceEffect(FileSystem.FileSystem, Effect.map(FileSystem.FileSystem, use))

describe("Migration.apply", () => {
  effect(
    "binds apply to the original workspace and platform services",
    () =>
      withFixture((originalRoot) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* PlatformPath.Path
          const crypto = yield* Crypto.Crypto
          let writes = 0
          const migration = yield* verified(
            createFile("src/bound.ts", "export const bound = true\n"),
          ).pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              writeFile: (target, data, options) =>
                Effect.sync(() => {
                  writes++
                }).pipe(
                  Effect.andThen(fs.writeFile(target, data, options)),
                ),
            }),
          )
          yield* withFixture((otherRoot) =>
            Effect.gen(function* () {
              yield* migration.apply.pipe(
                Effect.provideService(FileSystem.FileSystem, {
                  ...fs,
                  writeFile: () => Effect.die("ambient filesystem used"),
                }),
                Effect.provideService(PlatformPath.Path, {
                  ...path,
                  dirname: () => {
                    throw new Error("ambient path used")
                  },
                }),
                Effect.provideService(Crypto.Crypto, {
                  ...crypto,
                  randomUUIDv4: Effect.die("ambient crypto used"),
                }),
              )
              expect(yield* exists(otherRoot, "src/bound.ts")).toBe(false)
            })
          )
          expect(writes).toBe(1)
          expect(yield* read(originalRoot, "src/bound.ts")).toBe("export const bound = true\n")
        })
      ),
  )
  effect(
    "does not apply mutations to public preview bytes",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const content = "export const value = 1\n"
          const recipe = Recipe.define("verified-bytes", {
            version: "1.0.0",
            run: () =>
              Effect.succeed(Proposal.createFile(workspacePath("src/created.ts"), content)),
          })
          const plan = yield* verified(recipe)
          const after = plan.preview.files[0]!.after
          if (!after.exists) throw new Error("Expected a created file")
          after.bytes.fill(0)

          yield* plan.apply
          expect(yield* read(root, "src/created.ts")).toBe(content)
        })
      ),
  )

  effect(
    "rejects a new source consumer added after verification without writing",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const before = yield* read(root, "src/api.ts")
            const recipe = Recipe.define("rename-export", {
              version: "1.0.0",
              run: (snapshot) =>
                Effect.gen(function* () {
                  const project = yield* snapshot.project(app.id)
                  const file = (yield* project.file(workspacePath("src/api.ts")))!
                  return Proposal.replaceText(file, "export const renamed = 1\n")
                }),
            })
            const plan = yield* verified(recipe)
            const consumer = 'import { original } from "./api.js"\nexport const value = original\n'
            yield* write(root, "src/new-consumer.ts", consumer)

            const exit = yield* Effect.exit(plan.apply)
            expect(yield* read(root, "src/api.ts")).toBe(before)
            expect(yield* read(root, "src/new-consumer.ts")).toBe(consumer)
            expect(exit._tag).toBe("Failure")
          }),
        {
          fixture: "empty",
          files: {
            "tsconfig.json": JSON.stringify({
              compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
              include: ["src/**/*.ts"],
            }),
            "src/api.ts": "export const original = 1\n",
          },
        },
      ),
  )

  effect(
    "rejects a stricter extended tsconfig after verification without writing",
    () =>
      withFixture(
        (root) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("implicit-any", {
              version: "1.0.0",
              run: () =>
                Effect.succeed(Proposal.createFile(
                  workspacePath("src/created.ts"),
                  "export function identity(value) { return value }\n",
                )),
            })
            const plan = yield* verified(recipe)
            const stricter = JSON.stringify({ compilerOptions: { noImplicitAny: true } })
            yield* write(root, "tsconfig.base.json", stricter)

            const exit = yield* Effect.exit(plan.apply)
            expect(yield* exists(root, "src/created.ts")).toBe(false)
            expect(yield* read(root, "tsconfig.base.json")).toBe(stricter)
            expect(yield* read(root, "src/existing.ts")).toBe("export const existing = 1\n")
            expect(exit._tag).toBe("Failure")
          }),
        {
          fixture: "empty",
          files: {
            "tsconfig.json": JSON.stringify({
              extends: "./tsconfig.base.json",
              include: ["src/**/*.ts"],
            }),
            "tsconfig.base.json": JSON.stringify({ compilerOptions: { noImplicitAny: false } }),
            "src/existing.ts": "export const existing = 1\n",
          },
        },
      ),
  )

  effect(
    "creates, moves, edits, and deletes files in one plan, including empty ones",
    () =>
      withFixture(
        (root, app) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("file-lifecycle", {
              version: "1.0.0",
              policies: { diagnostics: "allow-new-errors" },
              run: (snapshot) =>
                Effect.gen(function* () {
                  const project = yield* snapshot.project(app.id)
                  const library = (yield* project.file(workspacePath("src/library.ts")))!
                  const empty = (yield* project.file(workspacePath("src/empty.ts")))!
                  const doomed = (yield* project.file(workspacePath("src/doomed.ts")))!
                  return Proposal.concat(
                    Proposal.createFile(workspacePath("src/created-empty.ts"), ""),
                    Proposal.moveFile(library, workspacePath("src/shared/core.ts")),
                    Proposal.insertBefore(project, library.sourceFile.statements[0]!, "// core\n"),
                    Proposal.moveFile(empty, workspacePath("src/moved-empty.ts")),
                    Proposal.deleteFile(doomed),
                  )
                }),
            })

            const { receipt } = yield* executeRecipe(recipe, undefined)
            expect(receipt.written.map((file) => file.fileName)).toEqual([
              "src/created-empty.ts",
              "src/moved-empty.ts",
              "src/shared/core.ts",
            ])
            expect(receipt.removed.map((file) => file.fileName)).toEqual([
              "src/doomed.ts",
              "src/empty.ts",
              "src/library.ts",
            ])

            expect(yield* read(root, "src/created-empty.ts")).toBe("")
            expect(yield* read(root, "src/moved-empty.ts")).toBe("")
            expect(yield* read(root, "src/shared/core.ts")).toMatch(/^\/\/ core\n.*function other/s)
            expect(yield* exists(root, "src/library.ts")).toBe(false)
            expect(yield* exists(root, "src/empty.ts")).toBe(false)
            expect(yield* exists(root, "src/doomed.ts")).toBe(false)
          }),
        { files: { "src/empty.ts": "", "src/doomed.ts": "export {}\n" } },
      ),
  )

  effect("keeps an edited file's mode and byte-order mark", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const script = Path.join(root, "src/script.ts")
          yield* Effect.promise(() => Fs.chmod(script, 0o777))
          const recipe = Recipe.define("edit-script", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = (yield* project.file(workspacePath("src/script.ts")))!
                return Proposal.insertAfter(project, file.sourceFile.statements[0]!, "\nexport {}")
              }),
          })
          yield* executeRecipe(recipe, undefined)

          const bytes = yield* Effect.promise(() => Fs.readFile(script))
          expect(bytes.toString("utf8")).toBe("\uFEFFexport const script = 1\nexport {}\n")
          expect((yield* Effect.promise(() => Fs.stat(script))).mode & 0o777).toBe(0o777)
        }),
      { files: { "src/script.ts": "\uFEFFexport const script = 1\n" } },
    ))

  effect("preserves a moved file's mode and byte-order mark", () =>
    withFixture(
      (root, app) =>
        Effect.gen(function* () {
          const source = Path.join(root, "src/script.ts")
          yield* Effect.promise(() => Fs.chmod(source, 0o777))
          const recipe = Recipe.define("move-script", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return Proposal.moveFile(
                  (yield* project.file(workspacePath("src/script.ts")))!,
                  workspacePath("src/moved.ts"),
                )
              }),
          })
          yield* executeRecipe(recipe, undefined)
          const moved = Path.join(root, "src/moved.ts")
          expect((yield* Effect.promise(() => Fs.readFile(moved))).toString("utf8")).toBe(
            "\uFEFFexport const script = 1\n",
          )
          expect((yield* Effect.promise(() => Fs.stat(moved))).mode & 0o777).toBe(0o777)
        }),
      { files: { "src/script.ts": "\uFEFFexport const script = 1\n" } },
    ))

  effect(
    "refuses to write through a symlink that leaves the project",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const outside = yield* Effect.promise(() =>
            Fs.mkdtemp(Path.join(Path.dirname(root), "safemods-outside-"))
          )
          yield* Effect.promise(() => Fs.symlink(outside, Path.join(root, "src/escape"), "dir"))

          const plan = yield* verified(createFile("src/escape/outside.ts", "export {}\n"))
          const failure = yield* Effect.flip(plan.apply)
          expect(failure._tag).toBe("ApplicationFailure")
          expect(yield* exists(outside, "outside.ts")).toBe(false)
          yield* Effect.promise(() => Fs.rm(outside, { recursive: true, force: true }))
        })
      ),
  )

  effect(
    "rechecks every touched file and writes nothing when one changed after verification",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("comment-imports", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const imports = yield* Query.imports(project)
                return Proposal.concat(
                  ...imports.map(({ value }) => Proposal.insertBefore(project, value, "// seen\n")),
                )
              }),
          })
          const plan = yield* verified(recipe)
          expect(plan.preview.files.length).toBeGreaterThan(1)
          const barrel = yield* read(root, "src/barrel.ts")
          yield* write(root, "src/reexport-consumer.ts", "changed\n")

          const failure = yield* Effect.flip(plan.apply)
          expect(failure).toMatchObject({
            _tag: "StaleMigrationError",
            path: "src/reexport-consumer.ts",
          })
          expect(yield* read(root, "src/reexport-consumer.ts")).toBe("changed\n")
          expect(yield* read(root, "src/barrel.ts")).toBe(barrel)
        })
      ),
  )

  effect(
    "rejects when an untouched fingerprinted dependency changes after verification",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const plan = yield* verified(createFile("src/created.ts", ""))
          yield* write(root, "tsconfig.json", '{ "compilerOptions": { "strict": false } }\n')
          const failure = yield* Effect.flip(plan.apply)
          expect(failure).toMatchObject({ _tag: "StaleMigrationError", path: "tsconfig.json" })
          expect(yield* exists(root, "src/created.ts")).toBe(false)
        })
      ),
  )

  effect(
    "does not overwrite a file that appeared at a create target",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const plan = yield* verified(createFile("src/raced.ts", ""))
          yield* write(root, "src/raced.ts", "created by another process\n")
          const failure = yield* Effect.flip(plan.apply)
          expect(failure._tag).toBe("StaleMigrationError")
          expect(yield* read(root, "src/raced.ts")).toBe("created by another process\n")
        })
      ),
  )

  effect(
    "does not overwrite a file that appeared at a move target",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const target = workspacePath("src/raced.ts")
          const recipe = Recipe.define("move", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return Proposal.moveFile(
                  (yield* project.file(workspacePath("src/library.ts")))!,
                  target,
                )
              }),
          })
          const plan = yield* verified(recipe)
          yield* write(root, target, "created by another process\n")
          const failure = yield* Effect.flip(plan.apply)
          expect(failure).toMatchObject({ _tag: "StaleMigrationError", path: "src" })
          expect(yield* read(root, target)).toBe("created by another process\n")
        })
      ),
  )

  for (const moved of [false, true]) {
    effect(
      `reconciles backup rename failure after mutation: ${moved}`,
      () =>
        withFixture((root, app) =>
          Effect.gen(function* () {
            const recipe = Recipe.define("delete", {
              version: "1.0.0",
              policies: { diagnostics: "allow-new-errors" },
              run: (snapshot) =>
                Effect.gen(function* () {
                  const project = yield* snapshot.project(app.id)
                  return Proposal.deleteFile(
                    (yield* project.file(workspacePath("src/library.ts")))!,
                  )
                }),
            })
            const before = yield* read(root, "src/library.ts")
            const failure = yield* Effect.flip(
              verified(recipe).pipe(
                Effect.flatMap((migration) => migration.apply),
                withFaultyFileSystem((fs) => ({
                  ...fs,
                  rename: (from, to) =>
                    to.endsWith(".backup") ?
                      (moved ? fs.rename(from, to) : Effect.void).pipe(
                        Effect.andThen(fs.readFile(Path.join(root, "missing"))),
                        Effect.asVoid,
                      ) :
                      fs.rename(from, to),
                })),
              ),
            )
            expect(failure).toMatchObject({ reason: "filesystem" })
            expect(yield* read(root, "src/library.ts")).toBe(before)
            expect(yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
              .not.toEqual(expect.arrayContaining([expect.stringContaining(".safemods-")]))
          })
        ),
    )
  }

  effect(
    "reports recovery when both a backup and its original target are absent",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("lost-backup", {
            version: "1.0.0",
            policies: { diagnostics: "allow-new-errors" },
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                return Proposal.deleteFile((yield* project.file(workspacePath("src/library.ts")))!)
              }),
          })
          const failure = yield* Effect.flip(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                rename: (from, to) =>
                  fs.rename(from, to).pipe(
                    Effect.andThen(fs.remove(to)),
                    Effect.andThen(fs.readFile(Path.join(root, "missing"))),
                    Effect.asVoid,
                  ),
              })),
            ),
          )
          expect(failure).toMatchObject({
            reason: "recovery",
            failures: [{ operation: "restore", path: expect.stringContaining(".backup") }],
          })
          expect(yield* exists(root, "src/library.ts")).toBe(false)
          expect(yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
            .not.toEqual(expect.arrayContaining([expect.stringContaining(".safemods-")]))
        })
      ),
  )

  effect(
    "preserves an occupant created immediately before installation",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const recipe = createFile("src/raced.ts", "planned\n")
          const failure = yield* Effect.flip(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                link: (from, to) =>
                  fs.writeFileString(to, "external\n").pipe(
                    Effect.andThen(fs.link(from, to)),
                  ),
              })),
            ),
          )
          expect(yield* read(root, "src/raced.ts")).toBe("external\n")
          expect(failure).toMatchObject({ reason: "recovery" })
          const temporaries = (yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
            .filter((name) => name.endsWith(".tmp"))
          expect(temporaries).toHaveLength(1)
          expect(yield* read(root, `src/${temporaries[0]}`)).toBe("planned\n")
        })
      ),
  )

  effect(
    "preserves an occupied restore target and its original backup",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("edit", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const file = (yield* project.file(workspacePath("src/barrel.ts")))!
                return Proposal.insertBefore(project, file.sourceFile.statements[0]!, "// edit\n")
              }),
          })
          const before = yield* read(root, "src/barrel.ts")
          const failure = yield* Effect.flip(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                writeFile: (target, data, options) =>
                  target.endsWith(".tmp") ?
                    fs.writeFileString(Path.join(root, "src/barrel.ts"), "external\n").pipe(
                      Effect.andThen(fs.readFile(Path.join(root, "missing"))),
                      Effect.asVoid,
                    ) :
                    fs.writeFile(target, data, options),
              })),
            ),
          )
          expect(failure).toMatchObject({ reason: "recovery" })
          expect(yield* read(root, "src/barrel.ts")).toBe("external\n")
          const backups = (yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
            .filter((name) => name.endsWith(".backup"))
          expect(backups).toHaveLength(1)
          expect(yield* read(root, `src/${backups[0]}`)).toBe(before)
        })
      ),
  )

  effect(
    "rolls back a file whose temporary link succeeds but reports failure",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const recipe = createFile("src/created.ts", "export const created = true\n")
          let injected = false

          const exit = yield* Effect.exit(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                link: (from, to) =>
                  from.includes(".safemods-") && from.endsWith(".tmp") && !injected ?
                    fs.link(from, to).pipe(
                      Effect.tap(() => Effect.sync(() => (injected = true))),
                      Effect.andThen(fs.readFile(Path.join(root, "missing"))),
                      Effect.asVoid,
                    ) :
                    fs.link(from, to),
              })),
            ),
          )

          expect(exit._tag).toBe("Failure")
          expect(yield* exists(root, "src/created.ts")).toBe(false)
          expect(yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
            .not.toEqual(expect.arrayContaining([expect.stringContaining(".safemods-")]))
        })
      ),
  )

  effect(
    "preserves output and its anchor when inode identity is unavailable",
    () =>
      withFixture((root) =>
        Effect.gen(function* () {
          const recipe = createFile("src/created.ts", "planned\n")
          const failure = yield* Effect.flip(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                stat: (target) =>
                  fs.stat(target).pipe(Effect.map((info) => ({ ...info, ino: Option.none() }))),
                link: (from, to) =>
                  fs.link(from, to).pipe(
                    Effect.andThen(fs.readFile(Path.join(root, "missing"))),
                    Effect.asVoid,
                  ),
              })),
            ),
          )
          expect(failure).toMatchObject({ reason: "recovery" })
          expect(yield* read(root, "src/created.ts")).toBe("planned\n")
          const temporaries = (yield* Effect.promise(() => Fs.readdir(Path.join(root, "src"))))
            .filter((name) => name.endsWith(".tmp"))
          expect(temporaries).toHaveLength(1)
          expect(yield* read(root, `src/${temporaries[0]}`)).toBe("planned\n")
        })
      ),
  )

  effect(
    "restores an edited file when a later write dies",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("edit-two-files", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const barrel = (yield* project.file(workspacePath("src/barrel.ts")))!
                const consumer = (yield* project.file(workspacePath("src/reexport-consumer.ts")))!
                return Proposal.concat(
                  Proposal.insertBefore(project, barrel.sourceFile.statements[0]!, "// edited\n"),
                  Proposal.insertBefore(project, consumer.sourceFile.statements[0]!, "// edited\n"),
                )
              }),
          })
          const barrelBefore = yield* read(root, "src/barrel.ts")
          const consumerBefore = yield* read(root, "src/reexport-consumer.ts")
          let temporaryWrites = 0

          const exit = yield* Effect.exit(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                writeFile: (target, data, options) =>
                  target.includes(".safemods-") && ++temporaryWrites === 2 ?
                    Effect.die(new Error("injected write failure")) :
                    fs.writeFile(target, data, options),
              })),
            ),
          )

          expect(exit._tag).toBe("Failure")
          expect(yield* read(root, "src/barrel.ts")).toBe(barrelBefore)
          expect(yield* read(root, "src/reexport-consumer.ts")).toBe(consumerBefore)
        })
      ),
  )

  effect(
    "rolls back before observing interruption",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("interrupt-edit", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const barrel = (yield* project.file(workspacePath("src/barrel.ts")))!
                return Proposal.insertBefore(
                  project,
                  barrel.sourceFile.statements[0]!,
                  "// edited\n",
                )
              }),
          })
          const before = yield* read(root, "src/barrel.ts")
          const writing = yield* Deferred.make<void>()

          const fiber = yield* verified(recipe).pipe(
            Effect.flatMap((migration) => migration.apply),
            withFaultyFileSystem((fs) => ({
              ...fs,
              writeFile: (target, data, options) =>
                target.includes(".safemods-") ?
                  Deferred.succeed(writing, undefined).pipe(Effect.andThen(Effect.never)) :
                  fs.writeFile(target, data, options),
            })),
            Effect.forkChild,
          )
          yield* Deferred.await(writing)
          yield* Fiber.interrupt(fiber)

          expect(yield* read(root, "src/barrel.ts")).toBe(before)
        })
      ),
  )

  effect(
    "reports cleanup failure as committed",
    () =>
      withFixture((root, app) =>
        Effect.gen(function* () {
          const recipe = Recipe.define("edit-file", {
            version: "1.0.0",
            run: (snapshot) =>
              Effect.gen(function* () {
                const project = yield* snapshot.project(app.id)
                const barrel = (yield* project.file(workspacePath("src/barrel.ts")))!
                return Proposal.insertBefore(
                  project,
                  barrel.sourceFile.statements[0]!,
                  "// committed\n",
                )
              }),
          })
          const failure = yield* Effect.flip(
            verified(recipe).pipe(
              Effect.flatMap((migration) => migration.apply),
              withFaultyFileSystem((fs) => ({
                ...fs,
                remove: (target, options) =>
                  target.includes(".backup") ?
                    Effect.die(new Error("injected cleanup failure")) :
                    fs.remove(target, options),
              })),
            ),
          )

          expect(failure).toMatchObject({
            _tag: "ApplicationFailure",
            reason: "committed",
            failures: [{ phase: "cleanup", operation: "cleanup-backup" }],
          })
          expect(yield* read(root, "src/barrel.ts")).toMatch(/^\/\/ committed\n/)
        })
      ),
  )
})
