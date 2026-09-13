import { eslintCompatPlugin } from "@oxlint/plugins"

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts"
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts"
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts"
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts"
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts"

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-unknown-parameters": noUnknownParametersRule,
    "no-unknown-returns": noUnknownReturnsRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
})

export default antiSlopPlugin
