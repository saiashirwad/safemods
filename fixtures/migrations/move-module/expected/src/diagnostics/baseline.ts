export interface Incident {
  readonly id: string
  readonly severity: "low" | "high"
}

// Deliberate baseline error: verification should keep this diagnostic and reject only regressions.
export const openIncident = (id: string): Incident => ({
  id,
  severity: 1,
})
