import { Option, Schema } from "effect"
import { isPathContained, projectRelative } from "../../ProjectPath.ts"
import * as ProjectRelativePath from "../../ProjectRelativePath.ts"
import type { WorkspaceRuntimeService } from "../Runtime.ts"

export interface Resolver {
  readonly fromProjectPath: (path: ProjectRelativePath.Type) => Option.Option<string>
  readonly toProjectPath: (fileName: string) => Option.Option<ProjectRelativePath.Type>
  readonly contains: (fileName: string) => boolean
}

export const forProject = (runtime: WorkspaceRuntimeService, projectRoot: string): Resolver => {
  const containmentOptions = { caseInsensitive: true } as const
  const resolvedProjectRoot = runtime.resolve(projectRoot)
  const canonicalProjectRoot = runtime.realPath(resolvedProjectRoot) ?? resolvedProjectRoot

  const comparisonHostPath = (fileName: string): string => {
    const resolved = runtime.resolve(fileName)
    const real = runtime.realPath(resolved)
    if (real !== undefined) return real
    if (
      !isPathContained(runtime, resolvedProjectRoot, resolved, {
        ...containmentOptions,
        includeRoot: true,
      })
    ) {
      return resolved
    }
    const relative = isPathContained(runtime, resolvedProjectRoot, resolved, {
      includeRoot: true,
    })
      ? runtime.relative(resolvedProjectRoot, resolved)
      : runtime.relative(
          resolvedProjectRoot.toLocaleLowerCase("en-US"),
          resolved.toLocaleLowerCase("en-US"),
        )
    return relative === "" ? canonicalProjectRoot : runtime.resolve(canonicalProjectRoot, relative)
  }

  const contains = (fileName: string): boolean =>
    isPathContained(runtime, canonicalProjectRoot, comparisonHostPath(fileName), containmentOptions)

  const decode = Schema.decodeOption(ProjectRelativePath.schema)
  const toProjectPath = (fileName: string): Option.Option<ProjectRelativePath.Type> => {
    const resolved = runtime.resolve(fileName)
    const real = runtime.realPath(resolved)
    if (real !== undefined) {
      const canonicalRelative = decode(projectRelative(runtime, canonicalProjectRoot, real))
      if (Option.isSome(canonicalRelative)) return canonicalRelative
    }
    const lexicalRelative = decode(projectRelative(runtime, resolvedProjectRoot, resolved))
    if (Option.isSome(lexicalRelative)) return lexicalRelative
    return decode(
      projectRelative(
        runtime,
        resolvedProjectRoot.toLocaleLowerCase("en-US"),
        resolved.toLocaleLowerCase("en-US"),
      ),
    )
  }

  const fromProjectPath = (path: ProjectRelativePath.Type): Option.Option<string> => {
    const candidate = runtime.resolve(projectRoot, path)
    return contains(candidate) ? Option.some(candidate) : Option.none()
  }

  return { fromProjectPath, toProjectPath, contains }
}
