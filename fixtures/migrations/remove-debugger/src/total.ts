export function total(values: ReadonlyArray<number>): number {
  let sum = 0
  for (const value of values) {
    debugger
    sum += value
  }
  debugger
  return sum
}

export const note = "a debugger in a string stays"
