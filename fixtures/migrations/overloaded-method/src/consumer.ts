import { client, client as api } from "./legacy-client.js"

const done = (error: Error | null, result?: { value: string }) => void [error, result]

client.lookup("plain", done)
client.lookup("fresh", { fresh: true }, done)
api.lookup("aliased", done)

client.lookup("already-promise")
client.lookup("already-options", { fresh: true })

const keys = ["spread"] as const
client.lookup(...keys, done)

const unrelated = {
  lookup(key: string, callback: typeof done) {
    callback(null, { value: key })
  },
}
unrelated.lookup("unrelated", done)
