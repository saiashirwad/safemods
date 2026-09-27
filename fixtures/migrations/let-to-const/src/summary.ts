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
