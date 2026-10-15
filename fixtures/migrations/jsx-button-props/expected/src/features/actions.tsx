import { Button, Button as ActionButton } from "../ui/index.js"
import * as UI from "../ui/index.js"

const forwarded = { oldLabel: "Forwarded" }

export const actions = (
  <>
    <Button label="Save" size />
    <ActionButton label="Cancel" size={false} />
    <UI.Button label="Delete" />
    <Button label="Current" oldLabel="Legacy" />
    <Button {...forwarded} oldLabel="After spread" />
    <Button oldLabel="Before spread" {...forwarded} />
    <Button size="large" compact />
    <Button label="Already migrated" size="small" />
  </>
)
