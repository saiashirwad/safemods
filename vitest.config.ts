import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "tools/check-boundaries.test.mjs"],
  },
})
