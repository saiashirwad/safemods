export interface Position {
  readonly line: number
  readonly column: number
}

export const at = (text: string, offset: number): Position => {
  const before = text.slice(0, offset)
  return { line: before.split("\n").length, column: before.length - before.lastIndexOf("\n") }
}
