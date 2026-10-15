import { Checks, type Config, WorkspacePath } from "safemods"
import { noUnknownFailures } from "./examples/no-unknown-failures.ts"

// The package's public surface: src/index.ts and every namespace it re-exports.
const publicApi = ["src/index.ts"]

export default {
  projects: [{ id: "safemods", config: "tsconfig.json" }],
  checks: [
    Checks.layers({
      within: "src/**",
      order: [
        [
          "src/Sha256.ts",
          "src/ProjectId.ts",
          "src/WorkspacePath.ts",
          "src/Position.ts",
          "src/Finding.ts",
          "src/ModuleSpecifier.ts",
          "src/Reason.ts",
        ],
        ["src/Edit.ts"],
        ["src/Workspace/"],
        ["src/Pattern.ts"],
        ["src/Query/", "src/Type.ts"],
        ["src/Proposal.ts", "src/Check.ts", "src/Inspect.ts"],
        ["src/Checks/"],
        ["src/Recipe.ts"],
        ["src/Migration/"],
        ["src/Config.ts"],
        ["src/bin.ts", "src/index.ts"],
      ],
    }),
    Checks.weakReturns({ within: "{src,examples}/**" }),
    Checks.typeBoundaries({
      within: "src/{Sha256,ProjectId,WorkspacePath,Edit}.ts",
      forbidden: { packages: ["typescript"] },
    }),
    Checks.unusedCode({ within: "src/**", tests: "test/**", publicApi }),
    noUnknownFailures({ within: "src/**" }),
    Checks.unusedOptionalParameters({ within: "{src,examples}/**", publicApi }),
    Checks.ignoredReturns({ within: "{src,examples}/**" }),
    Checks.duplicatedFunctions({ within: "{src,examples,test}/**", minimumLength: 60 }),
    Checks.restrictedReferences({
      name: "unsafeNative",
      declaredIn: WorkspacePath.schema.make("src/Workspace/ProjectSnapshot.ts"),
      allowedWithin: ["src/Workspace/**", "src/Migration/Diagnostics.ts", "test/**"],
    }),
  ],
} satisfies Config.Config
