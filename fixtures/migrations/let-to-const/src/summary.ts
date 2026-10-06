const describe = (...parts: ReadonlyArray<unknown>): string => parts.join(" ")

export function summary(values: ReadonlyArray<number>): string {
  let count = values.length
  let total = 0
  for (let index = 0; index < values.length; index++) total += values[index]!
  let [first, second] = values
  let left = 1
  let right = 2
  ;[left, right] = [right, left]
  let pending: number
  pending = count
  return describe(count, total, first, second, left, right, pending)
}

export function names(list: ReadonlyArray<string>): string {
  let joined = ""
  for (let name of list) joined += name
  return joined
}

export function loopTargets(values: number[], object: Record<string, number>) {
  let value = 0
  let key = ""
  let nested = 0
  let shorthand = 0
  let renamed = ""
  for (value of values) void value
  for (key in object) void key
  for ([nested] of [values]) void nested
  for ({ shorthand } of [{ shorthand: 1 }]) void shorthand
  for ({ key: renamed } of [{ key: "a" }]) void renamed
  return [value, key, nested, shorthand, renamed]
}

export function heritageWrites() {
  let count = 0
  let assigned = 0
  let closed = 0
  class Derived extends (() => {
    count++
    assigned = 1
    const update = () => { closed++ }
    update()
    return class {}
  })() {}
  return [Derived, count, assigned, closed]
}

export function defaultReads() {
  let fallback = 1
  let value = 0
  ;({ value = fallback } = {})
  ;[value = fallback] = []
  ;(value as number)++
  return value
}

export function destructuringTargets() {
  let shorthand = 0
  let renamed = 0
  let objectRest = {}
  let arrayRest: number[] = []
  ;({ shorthand } = { shorthand: 1 })
  ;({ key: renamed } = { key: 1 })
  ;({ ...objectRest } = { key: 1 })
  ;[...arrayRest] = [1]
  return [shorthand, renamed, objectRest, arrayRest]
}
