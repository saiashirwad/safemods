import * as Fs from "node:fs"
import type { Path } from "effect"
import type { FileSystem } from "typescript/unstable/fs"

export interface Overlay {
  readonly files: ReadonlyMap<string, string>
  readonly deleted: ReadonlySet<string>
}

const isInside = (path: Path.Path, directory: string, fileName: string): boolean =>
  fileName.startsWith(directory.endsWith(path.sep) ? directory : directory + path.sep)

const diskEntries = (path: Path.Path, directory: string) => {
  try {
    const entries = Fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? Fs.statSync(path.join(directory, entry.name), { throwIfNoEntry: false })
        : entry,
    }))
    return {
      files: entries.filter(({ kind }) => kind?.isFile()).map(({ name }) => name),
      directories: entries.filter(({ kind }) => kind?.isDirectory()).map(({ name }) => name),
    }
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause.code === "ENOENT" || cause.code === "ENOTDIR")
    ) {
      return undefined
    }
    throw cause
  }
}

export const fileSystem = (overlay: Overlay, path: Path.Path): FileSystem => {
  const files = new Map([...overlay.files].map(([name, text]) => [path.resolve(name), text]))
  const deleted = new Set([...overlay.deleted].map((name) => path.resolve(name)))
  const holdsFile = (directory: string): boolean =>
    [...files.keys()].some((fileName) => isInside(path, directory, fileName))

  return {
    readFile: (fileName) => {
      const resolved = path.resolve(fileName)
      return deleted.has(resolved) ? null : files.get(resolved)
    },
    fileExists: (fileName) => {
      const resolved = path.resolve(fileName)
      if (deleted.has(resolved)) return false
      return files.has(resolved) ? true : undefined
    },
    directoryExists: (directoryName) => (holdsFile(path.resolve(directoryName)) ? true : undefined),
    realpath: (name) => {
      const resolved = path.resolve(name)
      return files.has(resolved) || holdsFile(resolved) ? resolved : undefined
    },
    getAccessibleEntries: (directoryName) => {
      const directory = path.resolve(directoryName)
      const disk = diskEntries(path, directory)
      const isKept = (entry: string) => !deleted.has(path.join(directory, entry))
      const fileNames = new Set(disk?.files.filter(isKept))
      const directories = new Set(disk?.directories)
      for (const fileName of files.keys()) {
        if (!isInside(path, directory, fileName)) continue
        const [first, ...rest] = path.relative(directory, fileName).split(path.sep)
        if (rest.length === 0) fileNames.add(first!)
        else directories.add(first!)
      }
      return disk === undefined && fileNames.size === 0 && directories.size === 0
        ? undefined
        : { files: [...fileNames], directories: [...directories] }
    },
  }
}
