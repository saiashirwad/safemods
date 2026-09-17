/**
 * Split a mixed account module into model, service, and public index modules,
 * then rewrite consumers with type-only imports where possible.
 */
import { Effect } from "effect"
import * as Draft from "safemods/Draft"
import * as ProjectRelativePath from "safemods/ProjectRelativePath"
import * as Recipe from "safemods/Recipe"
import { type ConfiguredProject, WorkspaceSnapshot } from "safemods/Workspace"

export interface SplitModuleInput {
  readonly project: ConfiguredProject.Type
}

const paths = {
  source: ProjectRelativePath.schema.make("src/accounts.ts"),
  model: ProjectRelativePath.schema.make("src/accounts/model.ts"),
  service: ProjectRelativePath.schema.make("src/accounts/service.ts"),
  index: ProjectRelativePath.schema.make("src/accounts/index.ts"),
  handler: ProjectRelativePath.schema.make("src/http/account-handler.ts"),
  audit: ProjectRelativePath.schema.make("src/audit/account-event.ts"),
  publicApi: ProjectRelativePath.schema.make("src/public-api.ts"),
}

const model = `export interface Account {
  readonly id: string
  readonly email: string
}

export type AccountId = Account["id"]
`

const service = `import type { Account, AccountId } from "./model.js"

const accounts = new Map<AccountId, Account>()

export const findAccount = (id: AccountId): Account | undefined => accounts.get(id)

export const saveAccount = (account: Account): void => {
  accounts.set(account.id, account)
}
`

const index = `export type { Account, AccountId } from "./model.js"
export { findAccount, saveAccount } from "./service.js"
`

const handler = `import type { Account, AccountId } from "../accounts/model.js"
import { findAccount, saveAccount } from "../accounts/service.js"

export const getAccount = (id: AccountId): Account | undefined => findAccount(id)

export const putAccount = (account: Account): void => saveAccount(account)
`

const audit = `import type { Account, AccountId } from "../accounts/model.js"

export interface AccountEvent {
  readonly accountId: AccountId
  readonly snapshot: Account
}
`

const publicApi = `export type { Account, AccountId } from "./accounts/model.js"
export { findAccount, saveAccount } from "./accounts/service.js"
`

export const splitModule = Recipe.define("split-module", {
  version: "1.0.0",
  policies: { idempotence: "required" },
  run: (input: SplitModuleInput) =>
    Effect.gen(function* () {
      const snapshot = yield* WorkspaceSnapshot
      const project = yield* snapshot.project(input.project.id)
      const source = yield* project.textFile(paths.source)
      if (source === undefined) return Draft.empty

      const [existingModel, existingService, existingIndex] = yield* Effect.all([
        project.textFile(paths.model),
        project.textFile(paths.service),
        project.textFile(paths.index),
      ])
      if (
        existingModel !== undefined ||
        existingService !== undefined ||
        existingIndex !== undefined
      ) {
        return Draft.empty
      }

      const accountHandler = yield* project.textFile(paths.handler)
      const accountEvent = yield* project.textFile(paths.audit)
      const publicApiFile = yield* project.textFile(paths.publicApi)

      return Draft.concat(
        Draft.deleteFile(source),
        Draft.createFile(project, paths.model, model),
        Draft.createFile(project, paths.service, service),
        Draft.createFile(project, paths.index, index),
        accountHandler === undefined ? Draft.empty : Draft.replaceText(accountHandler, handler),
        accountEvent === undefined ? Draft.empty : Draft.replaceText(accountEvent, audit),
        publicApiFile === undefined ? Draft.empty : Draft.replaceText(publicApiFile, publicApi),
      )
    }),
})
