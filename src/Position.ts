export interface Position {
  readonly line: number
  readonly column: number
}

export type Locator = (offset: number) => Position

export const locator = (text: string): Locator => {
  const lineStarts = [0]
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    lineStarts.push(at + 1)
  }
  return (offset) => {
    const clamped = Math.min(offset, text.length)
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (lineStarts[middle]! <= clamped) low = middle
      else high = middle - 1
    }
    return { line: low + 1, column: clamped - lineStarts[low]! + 1 }
  }
}

export const at = (text: string, offset: number): Position => locator(text)(offset)

export const offset = (text: string, { line, column }: Position): number => {
  const before = text.split("\n").slice(0, line - 1)
  // mutant: position-offset
  return before.reduce((total, lineText) => total + lineText.length + 1, 0) + column - 1
}
