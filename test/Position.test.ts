import { describe, expect, it } from "@effect/vitest"
import * as Position from "../src/Position.ts"

describe("Position", () => {
  it("counts one-based lines and columns from a character offset", () => {
    const text = "ab\ncde\nf"
    expect(Position.at(text, 0)).toEqual({ line: 1, column: 1 })
    expect(Position.at(text, 2)).toEqual({ line: 1, column: 3 })
    expect(Position.at(text, 3)).toEqual({ line: 2, column: 1 })
    expect(Position.at(text, 7)).toEqual({ line: 3, column: 1 })
  })

  it("returns the character offset of a one-based line and column", () => {
    const text = "ab\ncde\nf"
    expect(Position.offset(text, { line: 1, column: 1 })).toBe(0)
    expect(Position.offset(text, { line: 1, column: 3 })).toBe(2)
    expect(Position.offset(text, { line: 2, column: 1 })).toBe(3)
    expect(Position.offset(text, { line: 3, column: 1 })).toBe(7)
  })

  it("round-trips every offset, including empty lines", () => {
    const text = "a\nbc\n\nd"
    for (let offset = 0; offset <= text.length; offset++) {
      expect(Position.offset(text, Position.at(text, offset))).toBe(offset)
    }
  })
})
