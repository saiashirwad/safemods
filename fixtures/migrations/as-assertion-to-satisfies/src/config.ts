interface Route {
  path: string
  method: "GET" | "POST"
}

const route = { path: "/health", method: "GET" } as Route
const routes = [{ path: "/", method: "GET" }] as Route[]

// These assignments verify the useful inference consequence: satisfies preserves literals
// and object shape where an assertion widens them.
const healthPath: "/health" = route.path
const firstMethod: "GET" = routes[0]!.method

// Explicit exclusions: these require judgment or have different semantics.
const parenthesized = ({ path: "/parenthesized", method: "GET" }) as Route
const chained = { path: "/chained", method: "GET" } as unknown as Route
const literal = "GET" as const

// Assertions outside a variable initializer are unrelated.
function acceptRoute(value: Route): Route {
  return value
}
acceptRoute({ path: "/call", method: "GET" } as Route)
export default { path: "/default", method: "GET" } as Route

export { chained, healthPath, firstMethod, literal, parenthesized, route, routes }
