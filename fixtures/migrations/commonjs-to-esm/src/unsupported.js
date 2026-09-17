const conditional = process.env.FEATURE && require("feature")
const computed = require(getPackageName())
exports[computedName] = conditional

function locallyInjected(require) {
  return require("not-a-module-reference")
}
