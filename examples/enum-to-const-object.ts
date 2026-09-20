/** Convert a non-ambient, unmerged string enum into an `as const` object and value union. */
import { Data, Effect, Predicate } from "effect"
import { SyntaxKind, type EnumDeclaration, type EnumMember } from "typescript/unstable/ast"
import { isEnumDeclaration, isIdentifier, isStringLiteral } from "typescript/unstable/ast/is"
import * as Draft from "safemods/Draft"
import type * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Query from "safemods/Query"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface EnumToConstObjectInput {
  readonly project: ConfiguredProject.Type
  readonly declarationFile: ProjectRelativePath.Type
  readonly enumName: string
}

export class UnsupportedEnum extends Data.TaggedError("UnsupportedEnum")<{
  readonly enumName: string
  readonly reasons: ReadonlyArray<string>
}> {}

const isAmbient = (declaration: EnumDeclaration): boolean =>
  declaration.modifiers?.some((modifier) => modifier.kind === SyntaxKind.DeclareKeyword) === true

const prefixOf = (declaration: EnumDeclaration): string =>
  declaration.modifiers
    ?.filter((modifier) => modifier.kind !== SyntaxKind.DeclareKeyword)
    .map((modifier) => `${modifier.getText()} `)
    .join("") ?? ""

const memberText = (member: EnumMember): string => {
  const source = member.getSourceFile()
  const trivia = source.text.slice(member.getFullStart(), member.getStart(source))
  const value = member.initializer === undefined ? "" : `: ${member.initializer.getText()}`
  return `${trivia}${member.name.getText()}${value}`
}

const replacement = (declaration: EnumDeclaration, name: string): string => {
  const prefix = prefixOf(declaration)
  const members = declaration.members.map(memberText).join(",")
  return [
    `${prefix}const ${name} = {${members}\n} as const`,
    `${prefix}type ${name} = (typeof ${name})[keyof typeof ${name}]`,
  ].join("\n")
}

const memberReason = (member: EnumMember): string | undefined => {
  if (!isIdentifier(member.name)) return "only identifier member names are supported"
  if (member.initializer === undefined) return "every member must have an explicit string literal"
  if (!isStringLiteral(member.initializer)) {
    return "numeric and computed enum members are unsupported"
  }
  return undefined
}

const reasonFor = (declaration: EnumDeclaration): string | undefined =>
  isAmbient(declaration) ?
    "ambient enums are unsupported" :
    declaration.members.map(memberReason).find(Predicate.isNotUndefined)

export const enumToConstObject = Recipe.define("enum-to-const-object", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: EnumToConstObjectInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const [target] = yield* Query.nodes(project, isEnumDeclaration).pipe(
        Query.within(input.declarationFile),
        Query.filter(({ value }) => value.name.text === input.enumName),
        Query.collect,
      )
      if (target === undefined) return Draft.empty

      const symbol = yield* project.symbolOf(target.value.name)
      const declarations = symbol === undefined ? [] : yield* project.declarationsOf(symbol)
      const merged = declarations.length > 1 ? ["merged enum declarations are unsupported"] : []
      const unsupported = declarations
        .filter(isEnumDeclaration)
        .map(reasonFor)
        .filter(Predicate.isNotUndefined)
      const reasons = [...new Set([...merged, ...unsupported])]
      if (reasons.length > 0) {
        return yield* new UnsupportedEnum({ enumName: input.enumName, reasons })
      }
      return Draft.replaceSelection(target, replacement(target.value, input.enumName))
    }),
})
