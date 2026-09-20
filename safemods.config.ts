import type * as Check from "safemods/Check"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
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

const publicApi = [
  "src/{Application,Check,Draft,Inspect,ModuleSpecifier,Pattern,Plan,ProjectId,ProjectRelativePath,Query,Recipe,Type,bin}.ts",
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
          "src/Position.ts",
          "src/ModuleSpecifier.ts",
        ],
        ["src/Edit.ts"],
        ["src/Plan.ts"],
        ["src/Workspace/"],
        ["src/Pattern.ts"],
        ["src/Query.ts", "src/Type.ts"],
        ["src/Draft.ts", "src/Check.ts", "src/Inspect.ts"],
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
} satisfies Check.Config
