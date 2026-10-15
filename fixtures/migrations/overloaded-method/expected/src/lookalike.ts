type Done = (error: Error | null, result?: { value: string }) => void

const client = {
  lookup(key: string, callback: Done): void {
    callback(null, { value: key })
  },
}

client.lookup("lookalike", () => undefined)
