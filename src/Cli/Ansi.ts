import { styleText } from "node:util"

type TextStyle = Parameters<typeof styleText>[0]

export const colorize = (text: string, style: TextStyle, enabled = true): string =>
  enabled ? styleText(style, text) : text
