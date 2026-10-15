export function total(values: ReadonlyArray<number>): number {
  let sum = 0
  for (const value of values) {
    
    sum += value
  }
  
  return sum
}

export const note = "a debugger in a string stays"
