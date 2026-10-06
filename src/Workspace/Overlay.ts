import * as Path from "node:path"
import type { FileSystemEntries } from "typescript/unstable/fs"

export interface CompilerFileSystem {
  readonly readFile: (fileName: string) => string | null
  readonly fileExists: (fileName: string) => boolean
  readonly directoryExists: (directoryName: string) => boolean
  readonly getAccessibleEntries: (directoryName: string) => FileSystemEntries
  readonly realpath: (path: string) => string
}

export interface Overlay {
  readonly files: ReadonlyMap<string, string>
  readonly deleted: ReadonlySet<string>
}

const isInside = (directory: string, fileName: string): boolean =>
  fileName.startsWith(directory.endsWith(Path.sep) ? directory : directory + Path.sep)

export const fileSystem = (overlay: Overlay, base: CompilerFileSystem): CompilerFileSystem => {
  const files = new Map([...overlay.files].map(([name, text]) => [Path.resolve(name), text]))
  const deleted = new Set([...overlay.deleted].map((name) => Path.resolve(name)))
  const holdsFile = (directory: string): boolean =>
    [...files.keys()].some((fileName) => !deleted.has(fileName) && isInside(directory, fileName))

  return {
    readFile: (fileName) => {
      const resolved = Path.resolve(fileName)
      return deleted.has(resolved) ? null : files.get(resolved) ?? base.readFile(resolved)
    },
    fileExists: (fileName) => {
      const resolved = Path.resolve(fileName)
      return !deleted.has(resolved) && (files.has(resolved) || base.fileExists(resolved))
    },
    directoryExists: (directoryName) =>
      holdsFile(Path.resolve(directoryName)) || base.directoryExists(Path.resolve(directoryName)),
    realpath: (name) => {
      const resolved = Path.resolve(name)
      return files.has(resolved) || holdsFile(resolved) ? resolved : base.realpath(resolved)
    },
    getAccessibleEntries: (directoryName) => {
      const directory = Path.resolve(directoryName)
      const disk = base.getAccessibleEntries(directory)
      const fileNames = new Set(
        disk.files.filter((entry) => !deleted.has(Path.join(directory, entry))),
      )
      const directories = new Set(disk.directories)
      for (const fileName of files.keys()) {
        if (deleted.has(fileName) || !isInside(directory, fileName)) continue
        const [first, ...rest] = Path.relative(directory, fileName).split(Path.sep)
        if (rest.length === 0) fileNames.add(first!)
        else directories.add(first!)
      }
      return { files: [...fileNames], directories: [...directories] }
    },
  }
}
