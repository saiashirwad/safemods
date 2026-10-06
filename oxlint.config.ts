import { defineConfig } from "oxlint"

export default defineConfig({
  options: { typeAware: true },
  plugins: ["typescript", "import", "effecttsgo"],
  categories: { correctness: "error" },
  ignorePatterns: ["node_modules/**", "dist/**", "fixtures/**"],
  rules: {
    "import/extensions": ["error", "always", { ignorePackages: true }],
    "import/no-cycle": ["error", { ignoreTypes: true }],
    "import/no-duplicates": ["error", { preferInline: true }],
    "no-duplicate-imports": "error",
    "typescript/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-unnecessary-condition": "error",
    "unicorn/prefer-node-protocol": "error",
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "safemods", message: "Import the concrete source module inside the package." },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["examples/**/*.ts", "safemods.config.ts", "test/**/*.ts"],
      rules: {
        "import/namespace": "off",
        "no-restricted-imports": "off",
      },
    },
    {
      files: ["test/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "effecttsgo/any-unknown-in-error-context": "off",
        "effecttsgo/unknown-in-effect-catch": "off",
      },
    },
    {
      files: ["scripts/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "safemods",
                message: "Import the concrete source module inside the package.",
              },
              {
                name: "node:child_process",
                message: "Use ChildProcessSpawner from effect/unstable/process.",
              },
              { name: "node:fs", message: "Use FileSystem from effect." },
              { name: "node:fs/promises", message: "Use FileSystem from effect." },
              { name: "node:path", message: "Use Path from effect." },
              { name: "node:url", message: "Use Path from effect." },
              { name: "node:os", message: "Use FileSystem.makeTempDirectoryScoped." },
            ],
          },
        ],
      },
    },
  ],
})
