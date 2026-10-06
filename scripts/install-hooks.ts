/**
 * Point this checkout's git hooks at the committed `.githooks` directory.
 * Runs from the `prepare` script; CI and packed consumers skip it.
 */
import { execFileSync } from "node:child_process"

if (process.env.CI === "true" || process.env.SKIP_SAFEMODS_HOOKS === "1") process.exit(0)

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" })
} catch {
  // Not a git checkout; nothing to install.
}
