import type * as Check from "safemods/Check"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import { layers } from "./checks/layers.ts"
import { restrictedReferences } from "./checks/restricted-references.ts"
import { weakReturns } from "./checks/weak-returns.ts"

export default {
  projects: [{ id: "safemods", config: "tsconfig.json" }],
  checks: [
    layers({
      within: "src/**",
      order: [
        ["src/Sha256.ts", "src/ProjectId.ts", "src/ProjectRelativePath.ts", "src/FileRef.ts"],
        ["src/Edit.ts"],
        ["src/Plan.ts"],
        ["src/Workspace/"],
        ["src/Query.ts", "src/Type.ts"],
        ["src/Draft.ts", "src/Check.ts"],
        ["src/Recipe.ts"],
        ["src/Verification/"],
        ["src/Application.ts"],
        ["src/bin.ts"],
      ],
    }),
    weakReturns({ within: "{src,checks,examples}/**" }),
    restrictedReferences({
      name: "unsafeNative",
      declaredIn: ProjectRelativePath.schema.make("src/Workspace/ProjectSnapshot.ts"),
      allowedWithin: ["src/Workspace/**", "src/Verification/Diagnostics.ts", "test/**"],
    }),
  ],
} satisfies Check.Config
