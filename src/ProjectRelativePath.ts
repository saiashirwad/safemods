import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect"

const normalize = (value: string, allowParent = false): string | undefined => {
  if (value.includes("\0") || /^([\\/]|[A-Za-z]:[\\/])/.test(value)) return undefined
  const parts: Array<string> = []
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.length === 0 || parts.at(-1) === "..") {
        if (!allowParent) return undefined
        parts.push(part)
      } else parts.pop()
      continue
    }
    if (part.includes(":")) return undefined
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join("/")
}

const normalized = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => normalize(value) === value, {
      expected: "a normalized project-relative path",
    }),
  ),
  Schema.brand("ProjectRelativePath"),
)

export const schema = Schema.String.pipe(
  Schema.decodeTo(
    normalized,
    SchemaTransformation.transformOrFail({
      decode: (value, options) => {
        const path = normalize(value)
        return path === undefined ?
          Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: "Expected a project-relative path" },
              value,
              options,
            ),
          ) :
          Effect.succeed(path)
      },
      encode: Effect.succeed,
    }),
  ),
)

export type Type = typeof schema.Type

export const decodeWorkspaceFile = (value: string): Type | undefined => {
  const path = normalize(value, true)
  return path === undefined ? undefined : (path as Type)
}
