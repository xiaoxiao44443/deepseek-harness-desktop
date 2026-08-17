import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  window: undefined as undefined | {
    webContents: EventEmitter & {
      mainFrame: { framesInSubtree: unknown[] }
      send: ReturnType<typeof vi.fn>
    }
  },
}))

vi.mock('electron', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events')

  class MockWebContents extends MockEventEmitter {
    mainFrame = { framesInSubtree: [] }
    send = vi.fn()
    setWindowOpenHandler = vi.fn()
    closeDevTools = vi.fn()
    isLoading(): boolean { return false }
  }

  class MockBrowserWindow extends MockEventEmitter {
    webContents = new MockWebContents()

    constructor() {
      super()
      electronMocks.window = this
    }

    async loadFile(): Promise<void> {}
    show(): void {}
    focus(): void {}
    isDestroyed(): boolean { return false }
    isMinimized(): boolean { return false }
    isMaximized(): boolean { return false }
  }

  return {
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '0.1.0',
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: { handle: vi.fn() },
    nativeTheme: { shouldUseDarkColors: true },
    shell: { openExternal: vi.fn() },
  }
})

import { WindowController } from './src/main/window-controller.js'

describe('WindowController Harness reload', () => {
  it('accepts main-process frame navigation and remounts a reused URL', async () => {
    const runtime = Object.assign(new EventEmitter(), {
      harnessHome: '/path/that/does/not/exist',
      updateState: { status: 'idle' },
      checkForUpdates: vi.fn(),
    })
    const development = Object.assign(new EventEmitter(), {
      state: {
        pnpmVersion: '11.19.0',
        restarting: false,
        commandRunning: false,
      },
      choosePatch: vi.fn(),
      clearPatch: vi.fn(),
      restartHarness: vi.fn(),
      runPlugin: vi.fn(),
    })
    const controller = new WindowController(runtime as never, development as never)
    await controller.create()

    const window = electronMocks.window
    expect(window).toBeDefined()
    const url = 'http://127.0.0.1:43210'

    const firstLoad = controller.showHarness(url, '0.1.0')
    const firstStartingState = window?.webContents.send.mock.calls.at(-1)?.[1]
    expect(firstStartingState).toMatchObject({ harnessLoadId: 1, harnessLifecycle: 'starting' })
    window?.webContents.emit('did-frame-navigate', {}, url, 200, 'OK', false)
    await firstLoad

    const secondLoad = controller.showHarness(url, '0.1.0')
    const secondStartingState = window?.webContents.send.mock.calls.at(-1)?.[1]
    expect(secondStartingState).toMatchObject({ harnessLoadId: 2, harnessLifecycle: 'starting' })
    window?.webContents.emit('did-frame-navigate', {}, url, 200, 'OK', false)
    await secondLoad

    const readyState = window?.webContents.send.mock.calls.at(-1)?.[1]
    expect(readyState).toMatchObject({ harnessLoadId: 2, harnessLifecycle: 'ready' })
  })

  it('detects a ready Harness frame even when renderer load events are missed', async () => {
    const runtime = Object.assign(new EventEmitter(), {
      harnessHome: '/path/that/does/not/exist',
      updateState: { status: 'idle' },
      checkForUpdates: vi.fn(),
    })
    const development = Object.assign(new EventEmitter(), {
      state: {
        pnpmVersion: '11.19.0',
        restarting: false,
        commandRunning: false,
      },
      choosePatch: vi.fn(),
      clearPatch: vi.fn(),
      restartHarness: vi.fn(),
      runPlugin: vi.fn(),
    })
    const controller = new WindowController(runtime as never, development as never)
    await controller.create()

    const url = 'http://127.0.0.1:43211'
    const frame = {
      parent: {},
      name: 'harness-frame',
      url,
      isDestroyed: () => false,
      executeJavaScript: vi.fn().mockResolvedValue('complete'),
    }
    const window = electronMocks.window
    expect(window).toBeDefined()
    if (window !== undefined) window.webContents.mainFrame.framesInSubtree = [frame]

    await controller.showHarness(url, '0.1.0')

    expect(frame.executeJavaScript).toHaveBeenCalledWith('document.readyState')
    expect(window?.webContents.send.mock.calls.at(-1)?.[1]).toMatchObject({
      harnessLoadId: 1,
      harnessLifecycle: 'ready',
    })
  })

  it('reveals a healthy Harness after a grace period when Electron reports no frame events', async () => {
    const runtime = Object.assign(new EventEmitter(), {
      harnessHome: '/path/that/does/not/exist',
      updateState: { status: 'idle' },
      checkForUpdates: vi.fn(),
    })
    const development = Object.assign(new EventEmitter(), {
      state: {
        pnpmVersion: '11.19.0',
        restarting: false,
        commandRunning: false,
      },
      choosePatch: vi.fn(),
      clearPatch: vi.fn(),
      restartHarness: vi.fn(),
      runPlugin: vi.fn(),
    })
    const controller = new WindowController(runtime as never, development as never)
    await controller.create()

    vi.useFakeTimers()
    try {
      const load = controller.showHarness('http://127.0.0.1:43212', '0.1.0')
      await vi.advanceTimersByTimeAsync(3_000)
      await load

      expect(electronMocks.window?.webContents.send.mock.calls.at(-1)?.[1]).toMatchObject({
        harnessLoadId: 1,
        harnessLifecycle: 'ready',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
