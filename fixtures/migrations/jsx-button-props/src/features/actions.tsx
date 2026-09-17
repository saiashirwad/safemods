import { Button, Button as ActionButton } from "../ui/index.js"
import * as UI from "../ui/index.js"

const forwarded = { oldLabel: "Forwarded" }

export const actions = (
  <>
    <Button oldLabel="Save" compact />
    <ActionButton oldLabel="Cancel" compact={false} />
    <UI.Button oldLabel="Delete" />
    <Button label="Current" oldLabel="Legacy" />
    <Button {...forwarded} oldLabel="After spread" />
    <Button oldLabel="Before spread" {...forwarded} />
    <Button size="large" compact />
    <Button label="Already migrated" size="small" />
  </>
)
