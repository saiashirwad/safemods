import { defineConfig } from "vitest/config"

// Tests that type-check a real workspace or spawn `src/bin.ts` take seconds each.
const slow = [
  "test/Migration/Apply.test.ts",
  "test/Check.test.ts",
  "test/Inspect.test.ts",
  "test/Migration/Preview.test.ts",
  "test/bin.test.ts",
  "test/Migration/Verify.test.ts",
]

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    reporters: ["dot"],
    projects: [
      {
        extends: true,
        test: { name: "slow", include: slow },
      },
      {
        extends: true,
        test: { name: "fast", include: ["test/**/*.test.ts"], exclude: slow },
      },
    ],
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
