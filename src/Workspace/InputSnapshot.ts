import * as Fs from "node:fs"
import * as Path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Data, Effect } from "effect"
import type { FileSystemEntries } from "typescript/unstable/fs"
import * as Overlay from "./Overlay.ts"

export class InputChanged extends Data.TaggedError("InputChanged")<{
  readonly path: string
}> {}

const missing = <A>(read: () => A): A | undefined => {
  try {
    return read()
  } catch (cause) {
    if (
      cause !== null && typeof cause === "object" && "code" in cause &&
      (cause.code === "ENOENT" || cause.code === "ENOTDIR")
    ) return undefined
    throw cause
  }
}

export class InputSnapshot {
  private readonly observations = new Map<string, {
    readonly path: string
    readonly value: unknown
    readonly read: () => unknown
  }>()

  private observe<A>(hook: string, absolute: string, read: () => A): A {
    const key = `${hook}:${absolute}`
    const previous = this.observations.get(key)
    if (previous !== undefined) return previous.value as A
    const value = read()
    this.observations.set(key, { path: absolute, value, read })
    return value
  }

  readBytes(absolute: string): Uint8Array | undefined {
    const resolved = Path.resolve(absolute)
    const bytes = this.observe("read", resolved, () => missing(() => Fs.readFileSync(resolved)))
    return bytes === undefined ? undefined : new Uint8Array(bytes)
  }

  readonly checkFresh: Effect.Effect<void, InputChanged> = Effect.suspend(() => {
    for (const observation of this.observations.values()) {
      try {
        if (isDeepStrictEqual(observation.value, observation.read())) continue
      } catch {
        return Effect.fail(new InputChanged({ path: observation.path }))
      }
      return Effect.fail(new InputChanged({ path: observation.path }))
    }
    return Effect.void
  })

  fileSystem(overlay?: Overlay.Overlay): Overlay.CompilerFileSystem {
    const base: Overlay.CompilerFileSystem = {
      readFile: (name) => {
        const bytes = this.readBytes(name)
        return bytes === undefined ?
          null :
          Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "")
      },
      fileExists: (name) => {
        const resolved = Path.resolve(name)
        return this.observe(
          "file",
          resolved,
          () => missing(() => Fs.statSync(resolved).isFile()) ?? false,
        )
      },
      directoryExists: (name) => {
        const resolved = Path.resolve(name)
        return this.observe(
          "directory",
          resolved,
          () => missing(() => Fs.statSync(resolved).isDirectory()) ?? false,
        )
      },
      getAccessibleEntries: (name) => {
        const resolved = Path.resolve(name)
        const entries = this.observe("entries", resolved, () =>
          missing(() => {
            const result: FileSystemEntries = { files: [], directories: [] }
            for (const entry of Fs.readdirSync(resolved, { withFileTypes: true })) {
              const kind = entry.isSymbolicLink() ?
                missing(() => Fs.statSync(Path.join(resolved, entry.name))) :
                entry
              if (kind?.isFile()) result.files.push(entry.name)
              if (kind?.isDirectory()) result.directories.push(entry.name)
            }
            result.files.sort()
            result.directories.sort()
            return result
          }))
        return {
          files: [...(entries?.files ?? [])],
          directories: [...(entries?.directories ?? [])],
        }
      },
      realpath: (name) => {
        const resolved = Path.resolve(name)
        return this.observe("realpath", resolved, () => missing(() => Fs.realpathSync(resolved))) ??
          resolved
      },
    }
    return overlay === undefined ? base : Overlay.fileSystem(overlay, base)
  }
}
