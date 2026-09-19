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
      files: ["examples/**/*.ts", "checks/**/*.ts", "safemods.config.ts", "test/**/*.ts"],
      rules: {
        "import/namespace": "off",
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
  ],
})
