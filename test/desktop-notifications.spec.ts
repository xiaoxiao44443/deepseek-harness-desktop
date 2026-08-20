import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const notificationMocks = vi.hoisted(() => ({
  supported: true,
  failure: undefined as string | undefined,
  instances: [] as Array<EventEmitter & { options: Record<string, unknown>; show: ReturnType<typeof vi.fn> }>,
}))

vi.mock('electron', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events')
  class MockNotification extends MockEventEmitter {
    static isSupported(): boolean { return notificationMocks.supported }
    show = vi.fn(() => queueMicrotask(() => {
      if (notificationMocks.failure === undefined) this.emit('show', {})
      else this.emit('failed', {}, notificationMocks.failure)
    }))
    constructor(readonly options: Record<string, unknown>) {
      super()
      notificationMocks.instances.push(this)
    }
  }
  return { Notification: MockNotification }
})

import {
  DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  DesktopNotificationService,
  readDesktopNotificationSettings,
} from '../src/main/desktop-notifications.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  notificationMocks.supported = true
  notificationMocks.failure = undefined
  notificationMocks.instances.length = 0
  await Promise.all(temporaryPaths.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })))
})

describe('DesktopNotificationService', () => {
  it('persists normalized settings with desktop defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    const path = join(root, 'notifications.json')
    expect(await readDesktopNotificationSettings(path)).toEqual(DEFAULT_DESKTOP_NOTIFICATION_SETTINGS)

    const service = new DesktopNotificationService(path, {
      getWindow: () => undefined,
      openSession: vi.fn(),
    })
    await service.initialize()
    await expect(service.updateSettings({
      turnCompletion: 'always',
      permissionRequests: false,
      questions: true,
    })).resolves.toEqual({
      turnCompletion: 'always',
      permissionRequests: false,
      questions: true,
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(service.currentSettings)
  })

  it('notifies on configured transitions and opens the owning session on click', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    const openSession = vi.fn()
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isFocused: () => false,
    }
    const service = new DesktopNotificationService(join(root, 'notifications.json'), {
      getWindow: () => window as never,
      openSession,
    })
    await service.initialize()

    await expect(service.show({
      kind: 'turn-complete',
      sessionId: 'session-1',
      sessionTitle: '测试对话',
      summary: '**你的图片** [已可查看](https://example.com/image)。',
      key: 'turn:session-1:2',
    })).resolves.toBe(true)
    const notification = notificationMocks.instances[0]
    expect(notification?.options).toMatchObject({
      title: '测试对话',
      body: '你的图片 已可查看。',
      tag: 'turn:session-1:2',
    })
    expect(notification?.show).toHaveBeenCalledOnce()
    notification?.emit('click')
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('suppresses completion while focused and honors interaction toggles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isFocused: () => true,
    }
    const service = new DesktopNotificationService(join(root, 'notifications.json'), {
      getWindow: () => window as never,
      openSession: vi.fn(),
    })
    await service.initialize()

    await expect(service.show({ kind: 'turn-complete', sessionId: 'session-1' })).resolves.toBe(false)
    await expect(service.show({ kind: 'approval', sessionId: 'session-1' })).resolves.toBe(true)
    await service.updateSettings({ turnCompletion: 'never', permissionRequests: false, questions: false })
    await expect(service.show({ kind: 'approval', sessionId: 'session-1' })).resolves.toBe(false)
    await expect(service.show({ kind: 'question', sessionId: 'session-1' })).resolves.toBe(false)
  })

  it('falls back to a concise completion body when the reply has no text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    const service = new DesktopNotificationService(join(root, 'notifications.json'), {
      getWindow: () => undefined,
      openSession: vi.fn(),
    })

    await expect(service.show({
      kind: 'turn-complete',
      sessionId: 'session-1',
      sessionTitle: '图片任务',
    })).resolves.toBe(true)
    expect(notificationMocks.instances[0]?.options).toMatchObject({
      title: '图片任务',
      body: '回复已完成。',
    })
  })

  it('uses the conversation title with approval, question, and plan summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    const service = new DesktopNotificationService(join(root, 'notifications.json'), {
      getWindow: () => undefined,
      openSession: vi.fn(),
    })

    await service.show({ kind: 'approval', sessionId: 'session-1', sessionTitle: '构建插件', summary: 'Bash：运行测试' })
    await service.show({ kind: 'question', sessionId: 'session-1', sessionTitle: '构建插件', summary: '请选择输出尺寸' })
    await service.show({ kind: 'plan-review', sessionId: 'session-1', sessionTitle: '构建插件', summary: '请审核实施计划' })

    expect(notificationMocks.instances.map((item) => item.options)).toEqual([
      expect.objectContaining({ title: '构建插件', body: '审批 · Bash：运行测试' }),
      expect.objectContaining({ title: '构建插件', body: '提问 · 请选择输出尺寸' }),
      expect.objectContaining({ title: '构建插件', body: '确认 · 请审核实施计划' }),
    ])
  })

  it('reports a native notification failure instead of treating show() as delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-notifications-'))
    temporaryPaths.push(root)
    notificationMocks.failure = 'application is not signed'
    const service = new DesktopNotificationService(join(root, 'notifications.json'), {
      getWindow: () => undefined,
      openSession: vi.fn(),
    })

    await expect(service.show({ kind: 'approval', sessionId: 'session-1' })).resolves.toBe(false)
  })

})
