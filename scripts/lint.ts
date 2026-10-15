/**
 * Lint gate that reports every failing tool in one run.
 *
 * `node scripts/lint.ts`        oxlint + knip
 * `node scripts/lint.ts --all`  also fmt:check, typecheck and the safemods self-check (`check:fast`)
 */
import { dprint, knip, main, oxlint, selfCheck, tsc } from "./run-checks.ts"

main(process.argv.includes("--all") ? [oxlint, knip, dprint, tsc, selfCheck] : [oxlint, knip])
