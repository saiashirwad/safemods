import type * as Check from "safemods/Check"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import {
  apiCompatibility,
  duplicatedFunctions,
  ignoredReturns,
  layers,
  restrictedReferences,
  typeBoundaries,
  unjustifiedCasts,
  unusedCode,
  unusedOptionalParameters,
  weakReturns,
} from "safemods/Checks"

const publicApi = [
  "src/{Application,Check,Comparison,Draft,Plan,ProjectId,ProjectRelativePath,Query,Recipe,Type,bin}.ts",
  "src/{Checks,Verification,Workspace}/index.ts",
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
          "src/ProjectRelativePath.ts",
          "src/FileRef.ts",
          "src/Git.ts",
        ],
        ["src/Edit.ts"],
        ["src/Plan.ts"],
        ["src/Workspace/"],
        ["src/Query.ts", "src/Type.ts"],
        ["src/Comparison.ts"],
        ["src/Draft.ts", "src/Check.ts"],
        ["src/Checks/"],
        ["src/Recipe.ts"],
        ["src/Verification/"],
        ["src/Application.ts"],
        ["src/bin.ts"],
      ],
    }),
    weakReturns({ within: "{src,examples}/**" }),
    typeBoundaries({
      within: "src/{Sha256,ProjectId,ProjectRelativePath,FileRef,Edit,Plan}.ts",
      forbidden: { packages: ["typescript"] },
    }),
    unjustifiedCasts({ within: "src/**" }),
    unusedCode({ within: "src/**", tests: "test/**", publicApi }),
    unusedOptionalParameters({ within: "{src,examples}/**", publicApi }),
    ignoredReturns({ within: "{src,examples}/**" }),
    duplicatedFunctions({ within: "{src,examples,test}/**", minimumLength: 60 }),
    restrictedReferences({
      name: "unsafeNative",
      declaredIn: ProjectRelativePath.schema.make("src/Workspace/ProjectSnapshot.ts"),
      allowedWithin: ["src/Workspace/**", "src/Verification/Diagnostics.ts", "test/**"],
    }),
  ],
  comparisons: [apiCompatibility({ within: "src/**" })],
} satisfies Check.Config
