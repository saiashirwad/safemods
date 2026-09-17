import { Data, Effect, Schema, SchemaIssue, SchemaTransformation } from "effect"

export class InvalidProjectRelativePath extends Data.TaggedError("InvalidProjectRelativePath")<{
  readonly path: string
}> {}

const canonicalPath = (value: string): string | undefined => {
  if (value.length === 0 || value.includes("\0")) return undefined
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    return undefined
  }

  const result: Array<string> = []
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (result.length === 0) return undefined
      result.pop()
      continue
    }
    if (part.includes(":")) return undefined
    result.push(part)
  }
  return result.length === 0 ? undefined : result.join("/")
}

const canonical = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => canonicalPath(value) === value, {
      expected: "a canonical project-relative path",
    }),
  ),
  Schema.brand("ProjectRelativePath"),
)

export const schema = Schema.String.pipe(
  Schema.decodeTo(
    canonical,
    SchemaTransformation.transformOrFail({
      decode: (value, options) => {
        const path = canonicalPath(value)
        return path === undefined
          ? Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: "Expected a project-relative path" },
                value,
                options,
              ),
            )
          : Effect.succeed(path)
      },
      encode: Effect.succeed,
    }),
  ),
)

export type Type = typeof schema.Type

export const make = (value: string): Effect.Effect<Type, InvalidProjectRelativePath> =>
  Schema.decodeEffect(schema)(value).pipe(
    Effect.mapError(() => new InvalidProjectRelativePath({ path: value })),
  )
