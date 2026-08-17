import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import type { WebFrameMain } from 'electron'
import type { ColorTheme, DesktopPlatform, DesktopState, DevelopmentPluginRequest, HarnessLifecycle, NavigationAction, TitleMenuAction, WindowAction } from '../shared/contracts.js'
import type { HarnessRuntimeManager } from './harness-runtime.js'
import type { DevelopmentService } from './development-service.js'

const STATE_CHANNEL = 'desktop:state'
const HARNESS_LOAD_TIMEOUT_MS = 45_000
const HARNESS_CHANGES_URL = 'https://github.com/deepseek-ai/deepseek-harness/commits/master/'

interface PendingHarnessLoad {
  url: string
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class WindowController {
  private window: BrowserWindow | undefined
  private harnessLifecycle: HarnessLifecycle = 'stopped'
  private harnessMessage: string | undefined
  private harnessVersion: string | undefined
  private harnessUrl: string | undefined
  private harnessOrigin: string | undefined
  private pendingHarnessLoad: PendingHarnessLoad | undefined
  private ipcRegistered = false
  private theme: ColorTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  private themeProbeTimer: NodeJS.Timeout | undefined
  private themeProbeInFlight = false

  constructor(
    private readonly runtime: HarnessRuntimeManager,
    private readonly development: DevelopmentService,
  ) {
    this.runtime.on('update-state', () => this.publishState())
    this.development.on('state', () => this.publishState())
  }

  async create(): Promise<void> {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      this.focus()
      return
    }

    this.theme = await this.readConfiguredTheme()

    const developerToolsEnabled = !app.isPackaged || process.argv.includes('--enable-devtools')
    const isMac = process.platform === 'darwin'
    const platform = this.desktopPlatform()
    const opaqueBackground = this.theme === 'dark' ? '#101114' : '#f4f5f7'
    const window = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      show: false,
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 14, y: 13 },
          }
        : { frame: false }),
      backgroundColor: process.platform === 'win32' ? '#00FFFFFF' : opaqueBackground,
      ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
      title: 'DeepSeek Harness',
      icon: this.resourcePath('app-icon.png'),
      webPreferences: {
        preload: fileURLToPath(new URL('../preload.cjs', import.meta.url)),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: developerToolsEnabled,
      },
    })
    this.window = window

    window.on('maximize', () => this.publishState())
    window.on('unmaximize', () => this.publishState())
    window.on('closed', () => {
      this.stopThemeSync()
      this.cancelPendingHarnessLoad(new Error('桌面窗口已关闭。'))
      this.window = undefined
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (!developerToolsEnabled) {
      window.webContents.on('devtools-opened', () => window.webContents.closeDevTools())
    }
    window.webContents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      if (this.safeOrigin(details.url) === this.harnessOrigin) return
      details.preventDefault()
      if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
        void shell.openExternal(details.url)
      }
    })
    window.webContents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame) => {
      if (!isMainFrame && this.safeOrigin(url) === this.harnessOrigin) this.publishState()
    })
    window.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
      if (isMainFrame || code === -3 || this.safeOrigin(validatedUrl) !== this.harnessOrigin) return
      this.setHarnessError(`页面加载失败：${description} (${code}) ${validatedUrl}`)
    })

    if (!this.ipcRegistered) this.registerIpc()
    const rendererDevUrl = !app.isPackaged
      ? process.env.HARNESS_DESKTOP_RENDERER_URL
      : undefined
    if (rendererDevUrl !== undefined) {
      const url = new URL(rendererDevUrl)
      url.searchParams.set('theme', this.theme)
      url.searchParams.set('platform', platform)
      await window.loadURL(url.toString())
    } else {
      await window.loadFile(join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { theme: this.theme, platform },
      })
    }
    window.show()
    this.publishState()
  }

  setRuntimePreparing(): void {
    this.stopThemeSync()
    this.cancelPendingHarnessLoad(new Error('Harness 运行时正在准备。'))
    this.harnessVersion = undefined
    this.harnessUrl = undefined
    this.harnessOrigin = undefined
    this.harnessLifecycle = 'starting'
    this.harnessMessage = app.isPackaged && process.platform === 'win32'
      ? '首次启动正在解压 Harness 运行时，请稍候…'
      : '正在准备本地 Harness 运行时…'
    this.publishState()
  }

  setHarnessStarting(version: string): void {
    this.stopThemeSync()
    this.cancelPendingHarnessLoad(new Error('Harness 启动目标已变更。'))
    this.harnessVersion = version
    this.harnessUrl = undefined
    this.harnessOrigin = undefined
    this.harnessLifecycle = 'starting'
    this.harnessMessage = '正在启动 Harness…'
    this.publishState()
  }

  async showHarness(url: string, version: string): Promise<void> {
    this.cancelPendingHarnessLoad(new Error('Harness 页面加载目标已变更。'))
    this.harnessVersion = version
    this.harnessUrl = url
    this.harnessOrigin = new URL(url).origin
    this.harnessLifecycle = 'starting'
    this.harnessMessage = '正在加载 Harness 界面…'

    const loadPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingHarnessLoad?.url !== url) return
        this.pendingHarnessLoad = undefined
        reject(new Error(`Harness 页面在 ${HARNESS_LOAD_TIMEOUT_MS / 1000} 秒内没有完成加载。`))
      }, HARNESS_LOAD_TIMEOUT_MS)
      this.pendingHarnessLoad = { url, resolve, reject, timer }
    })

    this.publishState()
    await loadPromise
  }

  setHarnessError(message: string): void {
    this.stopThemeSync()
    this.cancelPendingHarnessLoad(new Error(message))
    this.harnessLifecycle = 'error'
    this.harnessMessage = message
    this.harnessUrl = undefined
    this.harnessOrigin = undefined
    this.publishState()
  }

  focus(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  getBrowserWindow(): BrowserWindow | undefined {
    const window = this.window
    return window !== undefined && !window.isDestroyed() ? window : undefined
  }

  private registerIpc(): void {
    this.ipcRegistered = true
    ipcMain.handle('desktop:get-state', () => this.getState())
    ipcMain.handle('desktop:window-action', (_event, action: WindowAction) => this.windowAction(action))
    ipcMain.handle('desktop:navigate', (_event, action: NavigationAction) => this.navigate(action))
    ipcMain.handle('desktop:harness-frame-loaded', (event, url: string) => {
      if (event.sender !== this.window?.webContents) return
      this.handleHarnessFrameLoaded(url)
    })
    ipcMain.handle('desktop:title-menu-action', (_event, action: TitleMenuAction) => this.titleMenuAction(action))
    ipcMain.handle('desktop:check-update', () => this.runtime.checkForUpdates())
    ipcMain.handle('desktop:restart-update', () => {
      if (this.runtime.updateState.status !== 'ready') return
      app.relaunch()
      app.quit()
    })
    ipcMain.handle('desktop:development-choose-patch', () => this.development.choosePatch())
    ipcMain.handle('desktop:development-clear-patch', () => this.development.clearPatch())
    ipcMain.handle('desktop:development-restart', () => this.development.restartHarness())
    ipcMain.handle('desktop:development-run-plugin', (_event, request: DevelopmentPluginRequest) => this.development.runPlugin(request))
  }

  private windowAction(action: WindowAction): void {
    const window = this.mustWindow()
    if (action === 'minimize') window.minimize()
    else if (action === 'toggle-maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    else if (action === 'close') window.close()
  }

  private navigate(action: NavigationAction): void {
    if (action === 'reload') this.findHarnessFrame()?.reload()
  }

  private handleHarnessFrameLoaded(url: string): void {
    if (this.safeOrigin(url) !== this.harnessOrigin) return
    const pending = this.pendingHarnessLoad
    if (pending === undefined || pending.url !== this.harnessUrl) return
    clearTimeout(pending.timer)
    this.pendingHarnessLoad = undefined
    this.harnessLifecycle = 'ready'
    this.harnessMessage = undefined
    this.startThemeSync()
    this.publishState()
    pending.resolve()
  }

  private async titleMenuAction(action: TitleMenuAction): Promise<void> {
    const update = this.runtime.updateState
    if (action === 'update') {
      if (update.status === 'checking' || update.status === 'downloading') return
      if (update.status === 'ready') {
        app.relaunch()
        app.quit()
      } else {
        await this.runtime.checkForUpdates()
      }
    } else if (action === 'open-changes') {
      await shell.openExternal(HARNESS_CHANGES_URL)
    }
  }

  private getState(): DesktopState {
    const update = this.runtime.updateState
    return {
      appVersion: app.getVersion(),
      platform: this.desktopPlatform(),
      theme: this.theme,
      ...(this.harnessVersion !== undefined ? { harnessVersion: this.harnessVersion } : {}),
      ...(this.harnessUrl !== undefined ? { harnessUrl: this.harnessUrl } : {}),
      harnessLifecycle: this.harnessLifecycle,
      ...(this.harnessMessage !== undefined ? { harnessMessage: this.harnessMessage } : {}),
      updateStatus: update.status,
      ...(update.version !== undefined ? { updateVersion: update.version } : {}),
      ...(update.message !== undefined ? { updateMessage: update.message } : {}),
      development: this.development.state,
      isMaximized: this.window?.isMaximized() ?? false,
    }
  }

  private publishState(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || window.webContents.isLoading()) return
    window.webContents.send(STATE_CHANNEL, this.getState())
  }

  private resourcePath(name: string): string {
    return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name)
  }

  private findHarnessFrame(): WebFrameMain | undefined {
    const window = this.window
    if (window === undefined || window.isDestroyed() || this.harnessOrigin === undefined) return undefined
    return window.webContents.mainFrame.framesInSubtree.find((frame) => {
      if (frame.parent === null || frame.isDestroyed()) return false
      return frame.name === 'harness-frame' || this.safeOrigin(frame.url) === this.harnessOrigin
    })
  }

  private startThemeSync(): void {
    this.stopThemeSync()
    const probe = async (): Promise<void> => {
      if (this.themeProbeInFlight) return
      const frame = this.findHarnessFrame()
      if (frame === undefined) return
      this.themeProbeInFlight = true
      try {
        const theme = await frame.executeJavaScript(`(() => {
          const root = document.documentElement;
          const body = document.body;
          if (body?.hasAttribute('data-ds-dark-theme')) return 'dark';
          const declaredScheme = root.style.colorScheme || getComputedStyle(root).colorScheme;
          if (declaredScheme === 'dark' || declaredScheme === 'light') return declaredScheme;
          const explicit = [
            root.dataset.theme,
            root.getAttribute('data-color-theme'),
            root.getAttribute('data-mode'),
            body?.dataset.theme,
            ...root.classList,
            ...(body ? [...body.classList] : []),
          ].filter(Boolean).join(' ').toLowerCase();
          if (/(^|[\\s_-])dark($|[\\s_-])/.test(explicit)) return 'dark';
          if (/(^|[\\s_-])light($|[\\s_-])/.test(explicit)) return 'light';

          const candidates = [body, document.querySelector('#root'), root].filter(Boolean);
          for (const element of candidates) {
            const color = getComputedStyle(element).backgroundColor;
            const match = color.match(/rgba?\\(\\s*(\\d+)[, ]+\\s*(\\d+)[, ]+\\s*(\\d+)(?:[^)]*?([\\d.]+))?\\s*\\)/i);
            if (!match || (match[4] !== undefined && Number(match[4]) < 0.2)) continue;
            const red = Number(match[1]);
            const green = Number(match[2]);
            const blue = Number(match[3]);
            return (red * 0.2126 + green * 0.7152 + blue * 0.0722) < 145 ? 'dark' : 'light';
          }
          return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        })()`) as ColorTheme
        if ((theme === 'dark' || theme === 'light') && theme !== this.theme) {
          this.theme = theme
          this.publishState()
        }
      } catch {
        // Navigation may replace the iframe while a probe is running; the next probe retries.
      } finally {
        this.themeProbeInFlight = false
      }
    }
    void probe()
    this.themeProbeTimer = setInterval(() => { void probe() }, 300)
  }

  private async readConfiguredTheme(): Promise<ColorTheme> {
    try {
      const settings = await readFile(join(this.runtime.harnessHome, 'settings.yaml'), 'utf8')
      const themeBlock = settings.match(/^ui-theme\s*:\s*(?:#.*)?\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m)?.[1]
      const preference = themeBlock?.match(/^\s+preference\s*:\s*['"]?(dark|light|system)['"]?\s*(?:#.*)?$/mi)?.[1]
      if (preference === 'dark' || preference === 'light') return preference
    } catch {
      // Harness creates settings.yaml lazily; the system theme remains the safe fallback.
    }
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  private stopThemeSync(): void {
    if (this.themeProbeTimer !== undefined) clearInterval(this.themeProbeTimer)
    this.themeProbeTimer = undefined
    this.themeProbeInFlight = false
  }

  private cancelPendingHarnessLoad(error: Error): void {
    const pending = this.pendingHarnessLoad
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pendingHarnessLoad = undefined
    pending.reject(error)
  }

  private safeOrigin(url: string): string | undefined {
    try {
      return new URL(url).origin
    } catch {
      return undefined
    }
  }

  private desktopPlatform(): DesktopPlatform {
    if (process.platform === 'darwin') return 'macos'
    if (process.platform === 'win32') return 'windows'
    return 'linux'
  }

  private mustWindow(): BrowserWindow {
    if (this.window === undefined || this.window.isDestroyed()) throw new Error('Desktop window is not available')
    return this.window
  }
}
