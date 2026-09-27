import type { ReactNode } from 'react'

export function StatePanel({ title, children, role }: { title: string; children?: ReactNode; role?: 'alert' | 'status' }) {
  return <section className="state-panel" role={role}><h2>{title}</h2>{children}</section>
}
