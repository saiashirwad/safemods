import * as Fs from "node:fs"
import * as Path from "node:path"
import type { FileSystem } from "typescript/unstable/fs"

export interface Overlay {
  readonly files: ReadonlyMap<string, string>
  readonly deleted: ReadonlySet<string>
}

const isInside = (directory: string, fileName: string): boolean =>
  fileName.startsWith(directory.endsWith(Path.sep) ? directory : directory + Path.sep)

const diskEntries = (directory: string) => {
  try {
    const entries = Fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? Fs.statSync(Path.join(directory, entry.name), { throwIfNoEntry: false })
        : entry,
    }))
    return {
      files: entries.filter(({ kind }) => kind?.isFile()).map(({ name }) => name),
      directories: entries.filter(({ kind }) => kind?.isDirectory()).map(({ name }) => name),
    }
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined
    throw cause
  }
}

export const fileSystem = (overlay: Overlay): FileSystem => {
  const files = new Map([...overlay.files].map(([name, text]) => [Path.resolve(name), text]))
  const deleted = new Set([...overlay.deleted].map((name) => Path.resolve(name)))
  const holdsFile = (directory: string): boolean =>
    [...files.keys()].some((fileName) => isInside(directory, fileName))

  return {
    readFile: (fileName) => {
      const resolved = Path.resolve(fileName)
      return deleted.has(resolved) ? null : files.get(resolved)
    },
    fileExists: (fileName) => {
      const resolved = Path.resolve(fileName)
      if (deleted.has(resolved)) return false
      return files.has(resolved) ? true : undefined
    },
    directoryExists: (directoryName) => (holdsFile(Path.resolve(directoryName)) ? true : undefined),
    realpath: (path) => {
      const resolved = Path.resolve(path)
      return files.has(resolved) || holdsFile(resolved) ? resolved : undefined
    },
    getAccessibleEntries: (directoryName) => {
      const directory = Path.resolve(directoryName)
      const disk = diskEntries(directory)
      const isKept = (entry: string) => !deleted.has(Path.join(directory, entry))
      const fileNames = new Set(disk?.files.filter(isKept))
      const directories = new Set(disk?.directories)
      for (const fileName of files.keys()) {
        if (!isInside(directory, fileName)) continue
        const [first, ...rest] = Path.relative(directory, fileName).split(Path.sep)
        if (rest.length === 0) fileNames.add(first!)
        else directories.add(first!)
      }
      return disk === undefined && fileNames.size === 0 && directories.size === 0
        ? undefined
        : { files: [...fileNames], directories: [...directories] }
    },
  }
}
