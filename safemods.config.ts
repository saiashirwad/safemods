import type * as Config from "safemods/Config"
import * as WorkspacePath from "safemods/WorkspacePath"
import {
  duplicatedFunctions,
  ignoredReturns,
  layers,
  restrictedReferences,
  typeBoundaries,
  unusedCode,
  unusedOptionalParameters,
  weakReturns,
} from "safemods/Checks"
import { noUnknownFailures } from "./examples/no-unknown-failures.ts"

const publicApi = [
  "src/{Check,Config,Proposal,Finding,Inspect,ModuleSpecifier,Pattern,ProjectId,WorkspacePath,Query,Recipe,Type,bin,index}.ts",
  "src/{Checks,Migration,Workspace}/index.ts",
]

export default {
  projects: [{ id: "safemods", config: "tsconfig.json" }],
  checks: [
    layers({
      within: "src/**",
      order: [
        [
          "src/Sha256.ts",
          "src/ProjectId.ts",
          "src/WorkspacePath.ts",
          "src/Position.ts",
          "src/Finding.ts",
          "src/ModuleSpecifier.ts",
        ],
        ["src/Edit.ts"],
        ["src/Workspace/"],
        ["src/Pattern.ts"],
        ["src/Query.ts", "src/Type.ts"],
        ["src/Proposal.ts", "src/Check.ts", "src/Inspect.ts"],
        ["src/Checks/"],
        ["src/Recipe.ts"],
        ["src/Migration/"],
        ["src/Config.ts"],
        ["src/bin.ts", "src/index.ts"],
      ],
    }),
    weakReturns({ within: "{src,examples}/**" }),
    typeBoundaries({
      within: "src/{Sha256,ProjectId,WorkspacePath,Edit}.ts",
      forbidden: { packages: ["typescript"] },
    }),
    unusedCode({ within: "src/**", tests: "test/**", publicApi: [] }),
    noUnknownFailures({ within: "src/**" }),
    unusedOptionalParameters({ within: "{src,examples}/**", publicApi }),
    ignoredReturns({ within: "{src,examples}/**" }),
    duplicatedFunctions({ within: "{src,examples,test}/**", minimumLength: 60 }),
    restrictedReferences({
      name: "unsafeNative",
      declaredIn: WorkspacePath.schema.make("src/Workspace/ProjectSnapshot.ts"),
      allowedWithin: ["src/Workspace/**", "src/Migration/Diagnostics.ts", "test/**"],
    }),
  ],
} satisfies Config.Config
