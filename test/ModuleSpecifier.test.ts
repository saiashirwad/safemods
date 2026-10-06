import { describe, expect, it } from "@effect/vitest"
import * as ModuleSpecifier from "../src/ModuleSpecifier.ts"

const files = new Set([
  "src/accounts/store.ts",
  "src/accounts/index.ts",
  "src/feature/index.tsx",
])

describe("ModuleSpecifier", () => {
  it("classifies package, relative source, runtime and extensionless specifiers", () => {
    expect(ModuleSpecifier.parse("@acme/client")).toEqual({
      _tag: "Package",
      name: "@acme/client",
    })
    expect(ModuleSpecifier.parse("../accounts/store.ts")).toEqual({
      _tag: "Source",
      stem: "../accounts/store",
      extension: ".ts",
    })
    expect(ModuleSpecifier.parse("./store.js")).toEqual({
      _tag: "Runtime",
      stem: "./store",
      extension: ".js",
    })
    expect(ModuleSpecifier.parse("../accounts/store")).toEqual({
      _tag: "Extensionless",
      path: "../accounts/store",
    })
    expect(ModuleSpecifier.parse("..")).toEqual({ _tag: "Extensionless", path: ".." })
  })

  it("relates two files with a leading ./ when they are not parent paths", () => {
    expect(ModuleSpecifier.between("src/billing/invoices.ts", "src/accounts/store.ts")).toBe(
      "../accounts/store.ts",
    )
    expect(ModuleSpecifier.between("src/index.ts", "src/accounts.ts")).toBe("./accounts.ts")
  })

  it("maps a source extension to the runtime extension it emits", () => {
    expect(ModuleSpecifier.emitted("./store.ts")).toBe("./store.js")
    expect(ModuleSpecifier.emitted("./store.mts")).toBe("./store.mjs")
    expect(ModuleSpecifier.emitted("./store.d.ts")).toBe("./store.js")
    expect(ModuleSpecifier.emitted("./store.js")).toBe("./store.js")
  })

  it("resolves the file a relative specifier names, including index and trailing slash", () => {
    const from = "src/billing/invoices.ts"
    expect(ModuleSpecifier.fileNamedBy(files, from, "../accounts/store")).toBe(
      "src/accounts/store.ts",
    )
    expect(ModuleSpecifier.fileNamedBy(files, from, "../accounts")).toBe("src/accounts/index.ts")
    expect(ModuleSpecifier.fileNamedBy(files, from, "../accounts/")).toBe("src/accounts/index.ts")
    expect(ModuleSpecifier.fileNamedBy(files, "src/app.ts", "./feature")).toBe(
      "src/feature/index.tsx",
    )
    expect(ModuleSpecifier.fileNamedBy(files, from, "../missing")).toBeUndefined()
  })
})
