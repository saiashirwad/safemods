import { Checks, type Config } from "safemods"

export default {
  projects: [{ id: "consumer", config: "tsconfig.json" }],
  checks: [Checks.suppressions({ within: "src/**" })],
} satisfies Config.Config
