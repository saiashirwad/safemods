const path = require("node:path")
const { readFile, writeFile: saveFile } = require("node:fs")
const inspect = require("node:util").inspect
require("./register.js")

exports.readFile = readFile
module.exports.inspect = inspect
exports.read = readFile
const answer = 42
exports.answer = answer
exports.total = 1 + 2
module.exports = { path, saveFile }
