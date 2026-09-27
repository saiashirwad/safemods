export interface Position {
  readonly line: number
  readonly column: number
}

export const at = (text: string, offset: number): Position => {
  const before = text.slice(0, offset)
  return { line: before.split("\n").length, column: before.length - before.lastIndexOf("\n") }
}

export const offset = (text: string, { line, column }: Position): number => {
  const before = text.split("\n").slice(0, line - 1)
  return before.reduce((total, lineText) => total + lineText.length + 1, 0) + column - 1
}
