import { afterEach, describe, expect, it, vi } from 'vitest'

const originalWindow = globalThis.window

afterEach(() => {
  vi.resetModules()
  Object.assign(globalThis, { window: originalWindow })
})

async function loadClientModule(): Promise<Record<string, unknown>> {
  let factory: ((require: (id: string) => unknown) => Record<string, unknown>) | undefined
  Object.assign(globalThis, {
    window: {
      __ModuleLoader__: {
        load: (entry: { factory: typeof factory }) => { factory = entry.factory },
      },
    },
  })
  await import('./resources/dsh-desktop-bridge/lib/client.js')
  if (factory === undefined) throw new Error('Client bundle did not register its module factory')
  return factory((id) => {
    if (id === 'react') return {}
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected client dependency: ${id}`)
  })
}

describe('desktop notification session transitions', () => {
  it('suppresses the baseline and reports completion only after a running transition', async () => {
    const client = await loadClientModule()
    const project = client.projectSessions as (value: unknown) => Map<string, unknown>
    const diff = client.diffSessionNotifications as (
      previous: Map<string, unknown>,
      next: Map<string, unknown>,
    ) => Array<Record<string, unknown>>
    const initial = project({ byId: {
      one: { id: 'one', displayTitle: '旧对话', running: false, completed: true, updatedAt: 1 },
    } })
    expect(diff(new Map(), initial)).toEqual([])

    const running = project({ byId: {
      one: { id: 'one', displayTitle: '测试对话', running: true, updatedAt: 2 },
    } })
    const finished = project({ byId: {
      one: { id: 'one', displayTitle: '测试对话', running: false, updatedAt: 3 },
    } })
    expect(diff(running, finished)).toEqual([{
      kind: 'turn-complete',
      sessionId: 'one',
      sessionTitle: '测试对话',
      key: 'turn-complete:one:3',
    }])
  })

  it('prioritizes approval, question, and plan-review interactions', async () => {
    const client = await loadClientModule()
    const project = client.projectSessions as (value: unknown) => Map<string, unknown>
    const diff = client.diffSessionNotifications as (
      previous: Map<string, unknown>,
      next: Map<string, unknown>,
    ) => Array<Record<string, unknown>>
    const previous = project({ byId: {
      approval: { displayTitle: 'A', running: true, updatedAt: 1 },
      question: { displayTitle: 'Q', running: true, updatedAt: 1 },
      plan: { displayTitle: 'P', running: true, updatedAt: 1 },
    } })
    const next = project({ byId: {
      approval: { displayTitle: 'A', running: false, pendingInteraction: 'approval', updatedAt: 2 },
      question: { displayTitle: 'Q', running: true, pendingInteraction: 'question', updatedAt: 2 },
      plan: { displayTitle: 'P', running: true, pendingInteraction: 'plan-review', updatedAt: 2 },
    } })
    expect(diff(previous, next).map((event) => event.kind)).toEqual(['approval', 'question', 'question'])
  })

  it('reports an interaction that first appears with a newly created session', async () => {
    const client = await loadClientModule()
    const project = client.projectSessions as (value: unknown) => Map<string, unknown>
    const diff = client.diffSessionNotifications as (
      previous: Map<string, unknown>,
      next: Map<string, unknown>,
    ) => Array<Record<string, unknown>>
    const next = project({ byId: {
      newSession: {
        displayTitle: '新对话',
        running: true,
        pendingInteraction: 'question',
        updatedAt: 2,
      },
    } })

    expect(diff(new Map(), next)).toEqual([{
      kind: 'question',
      sessionId: 'newSession',
      sessionTitle: '新对话',
      key: 'question:newSession:2',
    }])
  })
})
