import * as path from "node:path"
import { readFile, writeFile as saveFile } from "node:fs"
import { inspect } from "node:util"
import "./register.js"

export { readFile }
export { inspect }
export { readFile as read }
const answer = 42
export { answer }
export const total = 1 + 2
export default { path, saveFile }
