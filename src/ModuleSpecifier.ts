import { dirname, normalize, relative } from "node:path/posix"

const sourceExtensions = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts"] as const
const runtimeExtensions = [".js", ".jsx", ".mjs", ".cjs", ".json"] as const

export type SourceExtension = (typeof sourceExtensions)[number]
export type RuntimeExtension = (typeof runtimeExtensions)[number]

const emittedExtension: Record<SourceExtension, RuntimeExtension> = {
  ".d.ts": ".js",
  ".d.mts": ".mjs",
  ".d.cts": ".cjs",
  ".ts": ".js",
  ".tsx": ".js",
  ".mts": ".mjs",
  ".cts": ".cjs",
}

export type Written =
  | { readonly _tag: "Package"; readonly name: string }
  | { readonly _tag: "Extensionless"; readonly path: string }
  | { readonly _tag: "Source"; readonly stem: string; readonly extension: SourceExtension }
  | { readonly _tag: "Runtime"; readonly stem: string; readonly extension: RuntimeExtension }

const split = <E extends string>(
  path: string,
  extensions: ReadonlyArray<E>,
): { readonly stem: string; readonly extension: E } | undefined => {
  const extension = extensions.find((candidate) => path.endsWith(candidate))
  return extension === undefined ? undefined : { stem: path.slice(0, -extension.length), extension }
}

export const parse = (text: string): Written => {
  if (!/^\.\.?(?:\/|$)/.test(text)) return { _tag: "Package", name: text }
  const source = split(text, sourceExtensions)
  if (source !== undefined) return { _tag: "Source", ...source }
  const runtime = split(text, runtimeExtensions)
  return runtime === undefined
    ? { _tag: "Extensionless", path: text }
    : { _tag: "Runtime", ...runtime }
}

export const between = (fromFile: string, targetFile: string): string => {
  const path = relative(dirname(fromFile), targetFile)
  return path.startsWith(".") ? path : `./${path}`
}

export const emitted = (path: string): string => {
  const source = split(path, sourceExtensions)
  return source === undefined ? path : `${source.stem}${emittedExtension[source.extension]}`
}

export const fileNamedBy = (
  files: ReadonlySet<string>,
  fromFile: string,
  specifier: string,
): string | undefined => {
  const path = normalize(`${dirname(fromFile)}/${specifier}`).replace(/\/$/, "")
  return [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`].find((file) =>
    files.has(file),
  )
}
