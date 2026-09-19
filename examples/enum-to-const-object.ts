/** Convert a non-ambient, unmerged string enum into an `as const` object and value union. */
import { Data, Effect } from "effect"
import { SyntaxKind, type EnumDeclaration } from "typescript/unstable/ast"
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

const modifiers = (declaration: EnumDeclaration): string =>
  declaration.modifiers
    ?.filter((modifier) => modifier.kind !== SyntaxKind.DeclareKeyword)
    .map((modifier) => modifier.getText())
    .join(" ") ?? ""

const memberText = (member: EnumDeclaration["members"][number]): string => {
  const source = member.getSourceFile()
  const start = member.getFullStart()
  const trivia = source.text.slice(start, member.getStart(source))
  return `${trivia}${member.name.getText()}${member.initializer === undefined ? "" : `: ${member.initializer.getText()}`}`
}

const replacement = (declaration: EnumDeclaration, name: string): string => {
  const prefix = modifiers(declaration)
  const members = declaration.members.map(memberText).join(",")
  return `${prefix === "" ? "" : `${prefix} `}const ${name} = {${members}\n} as const\n${prefix === "" ? "" : `${prefix} `}type ${name} = (typeof ${name})[keyof typeof ${name}]`
}

const reasonFor = (declaration: EnumDeclaration): string | undefined => {
  if (declaration.modifiers?.some((modifier) => modifier.kind === SyntaxKind.DeclareKeyword)) {
    return "ambient enums are unsupported"
  }
  for (const member of declaration.members) {
    if (!isIdentifier(member.name)) return "only identifier member names are supported"
    if (member.initializer === undefined) return "every member must have an explicit string literal"
    if (!isStringLiteral(member.initializer)) {
      return "numeric and computed enum members are unsupported"
    }
  }
  return undefined
}

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
      const reasons = [
        ...(declarations.length > 1 ? ["merged enum declarations are unsupported"] : []),
        ...declarations.filter(isEnumDeclaration).flatMap((declaration) => {
          const reason = reasonFor(declaration)
          return reason === undefined ? [] : [reason]
        }),
      ]
      if (reasons.length > 0) {
        return yield* new UnsupportedEnum({
          enumName: input.enumName,
          reasons: [...new Set(reasons)],
        })
      }
      return Draft.replaceSelection(target, replacement(target.value, input.enumName))
    }),
})
