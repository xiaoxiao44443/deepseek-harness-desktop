interface AgentPointerIconProps {
  className: string
}

const POINTER_PATH = 'M2.8 2.1v17.55l4.4-4.1 3.32 7.65 3.72-1.62-3.24-7.46 6.42-.17L2.8 2.1Z'

export function AgentPointerIcon({ className }: AgentPointerIconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 20 25" fill="none" aria-label="Agent 正在操作">
      <path d={POINTER_PATH} fill="currentColor" stroke="var(--agent-pointer-stroke)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
