export async function save(id: string): Promise<string> {
  return id
}

export function log(message: string): string {
  return message
}

export async function start(): Promise<void> {
  save("dropped")
  log("started")
  void save("already marked")
  await save("awaited")
  const kept = save("kept")
  await kept
}
