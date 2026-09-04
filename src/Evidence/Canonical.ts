import { Predicate } from "effect"
import type { Json } from "./Evidence.ts"

export const canonicalJson = (value: Json): string =>
  JSON.stringify(value, (_, v: Json) =>
    Predicate.isObject(v) && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
