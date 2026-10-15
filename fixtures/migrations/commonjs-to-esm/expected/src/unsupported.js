const conditional = process.env.FEATURE && require("feature")
const computed = require(getPackageName())
exports[computedName] = conditional
let current = 1
exports.current = current
current = 2
exports.missing = missing
const occupied = 0
exports.occupied = 1 + 2

function locallyInjected(require) {
  return require("not-a-module-reference")
}
