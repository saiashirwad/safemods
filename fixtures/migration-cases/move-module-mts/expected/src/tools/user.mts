import { now } from "../shared/clock.mjs"
import { later } from "./clock-utils.mjs"
export const soon = later(now())
