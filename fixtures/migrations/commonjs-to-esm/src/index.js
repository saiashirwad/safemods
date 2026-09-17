const path = require("node:path")
const { readFile, writeFile: saveFile } = require("node:fs")
const inspect = require("node:util").inspect
require("./register.js")

exports.readFile = readFile
module.exports.inspect = inspect
module.exports = { path, saveFile }
