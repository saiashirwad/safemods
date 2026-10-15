/**
 * Fast per-file gate for the edit loop: `pnpm check:file <paths...>`.
 * Runs oxlint and dprint on the paths plus a project-wide `tsc --noEmit`.
 * Silent on success; every failing tool is reported in one run.
 */
import { dprint, main, oxlint, tsc } from "./run-checks.ts"

const paths = process.argv.slice(2)
if (paths.length === 0) {
  throw new Error("usage: pnpm check:file <paths...>")
}

main([
  { ...oxlint, args: paths },
  { ...dprint, args: [...dprint.args, ...paths] },
  tsc,
])
