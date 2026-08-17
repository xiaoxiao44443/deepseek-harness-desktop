import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
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
    undo = vi.fn()
    redo = vi.fn()
    cut = vi.fn()
    copy = vi.fn()
    paste = vi.fn()
    selectAll = vi.fn()
    setWindowOpenHandler = vi.fn()
    closeDevTools = vi.fn()
    // A Harness subframe can still report loading after the desktop shell is
    // ready. State publication must only be gated on the main frame.
    isLoading(): boolean { return true }
    isLoadingMainFrame(): boolean { return false }
    isDestroyed(): boolean { return false }
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
    clipboard: { writeText: electronMocks.clipboardWriteText },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        electronMocks.ipcHandlers.set(channel, handler)
      }),
    },
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

  it('blocks keyboard reload shortcuts at the main window boundary', async () => {
    const runtime = Object.assign(new EventEmitter(), {
      harnessHome: '/path/that/does/not/exist',
      updateState: { status: 'idle' },
      checkForUpdates: vi.fn(),
    })
    const development = Object.assign(new EventEmitter(), {
      state: { pnpmVersion: '11.19.0', restarting: false, commandRunning: false },
      choosePatch: vi.fn(),
      clearPatch: vi.fn(),
      restartHarness: vi.fn(),
      runPlugin: vi.fn(),
    })
    const controller = new WindowController(runtime as never, development as never)
    await controller.create()

    const commandReload = { preventDefault: vi.fn() }
    electronMocks.window?.webContents.emit('before-input-event', commandReload, {
      key: 'r',
      control: false,
      meta: true,
    })
    expect(commandReload.preventDefault).toHaveBeenCalledOnce()

    const f5Reload = { preventDefault: vi.fn() }
    electronMocks.window?.webContents.emit('before-input-event', f5Reload, {
      key: 'F5',
      control: false,
      meta: false,
    })
    expect(f5Reload.preventDefault).toHaveBeenCalledOnce()

    const plainR = { preventDefault: vi.fn() }
    electronMocks.window?.webContents.emit('before-input-event', plainR, {
      key: 'r',
      control: false,
      meta: false,
    })
    expect(plainR.preventDefault).not.toHaveBeenCalled()
  })

  it('opens the core context menu without a Harness client plugin', async () => {
    const runtime = Object.assign(new EventEmitter(), {
      harnessHome: '/path/that/does/not/exist',
      updateState: { status: 'idle' },
      checkForUpdates: vi.fn(),
    })
    const development = Object.assign(new EventEmitter(), {
      state: { pnpmVersion: '11.19.0', restarting: false, commandRunning: false },
      choosePatch: vi.fn(),
      clearPatch: vi.fn(),
      restartHarness: vi.fn(),
      runPlugin: vi.fn(),
    })
    const controller = new WindowController(runtime as never, development as never)
    await controller.create()

    const url = 'http://127.0.0.1:43213'
    const frame = {
      parent: {},
      name: 'harness-frame',
      url,
      isDestroyed: () => false,
      executeJavaScript: vi.fn(async (script: string) => script === 'document.readyState' ? 'complete' : null),
    }
    const window = electronMocks.window
    expect(window).toBeDefined()
    if (window !== undefined) window.webContents.mainFrame.framesInSubtree = [frame]
    await controller.showHarness(url, '0.1.0')

    const contextEvent = { preventDefault: vi.fn() }
    window?.webContents.emit('context-menu', contextEvent, {
      x: 320,
      y: 240,
      frame,
      frameURL: url,
      linkURL: '',
      selectionText: 'selected text',
      isEditable: false,
      editFlags: {
        canUndo: false,
        canRedo: false,
        canCut: false,
        canCopy: true,
        canPaste: false,
        canDelete: false,
        canSelectAll: true,
        canEditRichly: false,
      },
    })

    await vi.waitFor(() => {
      expect(window?.webContents.send.mock.calls.some(([channel]) => channel === 'desktop:context-menu')).toBe(true)
    })
    expect(contextEvent.preventDefault).toHaveBeenCalledOnce()
    const request = window?.webContents.send.mock.calls.find(([channel]) => channel === 'desktop:context-menu')?.[1]
    expect(request).toMatchObject({
      x: 320,
      y: 240,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'desktop.copy', enabled: true }),
        expect.objectContaining({ id: 'desktop.select-all', enabled: true }),
      ]),
    })
    const select = electronMocks.ipcHandlers.get('desktop:context-menu-select')
    expect(select).toBeDefined()
    if (select !== undefined && window !== undefined && request !== undefined) {
      await select({ sender: window.webContents }, { requestId: request.requestId, itemId: 'desktop.copy' })
    }
    expect(electronMocks.clipboardWriteText).toHaveBeenCalledWith('selected text')
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
