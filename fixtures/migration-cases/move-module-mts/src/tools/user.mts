import { now } from "./clock.mjs"
import { later } from "./clock-utils.mjs"
export const soon = later(now())
