declare namespace JSX {
  interface IntrinsicElements {
    button: Record<string, unknown>
  }
}

export interface ButtonProps {
  oldLabel?: string
  label?: string
  compact?: boolean
  size?: boolean | "small" | "large"
}

export function Button(_props: ButtonProps) {
  return <button />
}
