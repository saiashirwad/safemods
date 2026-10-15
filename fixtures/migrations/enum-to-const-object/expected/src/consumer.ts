import { Status, type Status as StatusValue } from "./status.js"

export const render = (status: StatusValue): string =>
  status === Status.Complete ? "done" : "waiting"
