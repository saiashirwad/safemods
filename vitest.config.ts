import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "examples/**/*.ts"],
      // Executable surfaces driven through a spawned `src/bin.ts` in tests:
      // V8 only reports the parent process, so these read as 0% despite their
      // end-to-end CLI tests. They are excluded from the ratchet, not untested.
      exclude: [
        "src/bin.ts",
        "src/Inspect.ts",
        "src/Config.ts",
        "examples/run.ts",
        "examples/rename-symbol.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 96,
        branches: 90,
        functions: 97,
        lines: 97,
      },
    },
  },
})
