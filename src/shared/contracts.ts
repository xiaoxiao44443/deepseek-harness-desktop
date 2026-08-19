import type { DesktopContextMenuActionRequest, DesktopContextMenuRequest, DesktopPointerInput } from './context-menu.js'

export type HarnessLifecycle = 'starting' | 'ready' | 'stopped' | 'error'
export type ColorTheme = 'dark' | 'light'
export type DesktopPlatform = 'windows' | 'macos' | 'linux'

export type HarnessUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error'

export interface DevelopmentState {
  patchPath?: string
  dshVersion?: string
  pnpmVersion: string
  restarting: boolean
  commandRunning: boolean
  lastCommand?: string
  commandOutput?: string
  lastExitCode?: number
}

export interface DevelopmentPluginRequest {
  profile: string
  argumentsText: string
}

export interface PluginRecoveryEntry {
  entryId: string
  pluginName: string
}

export interface PluginInitializationFailure extends PluginRecoveryEntry {
  detail: string
  recoverable: boolean
}

export type BrowserAgentOpenMode = 'background' | 'visible'
export type BrowserDisplayMode = 'split' | 'drawer' | 'floating'
export type BrowserMenuKind = 'application' | 'display' | 'settings'
export type DesktopApplicationMenuAction = 'development' | 'release-notes' | 'update'

export interface DesktopApplicationMenuState {
  appVersion: string
  harnessVersion?: string
  updateStatus: HarnessUpdateStatus
  updateVersion?: string
  patchEnabled: boolean
}

export interface DesktopBrowserMenuAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopBrowserSettings {
  enabled: boolean
  agentOpenMode: BrowserAgentOpenMode
  displayMode: BrowserDisplayMode
}

export interface DesktopBrowserViewport {
  width: number
  height: number
  deviceScaleFactor?: number
}

export interface DesktopBrowserTabState {
  id: string
  title: string
  url: string
  faviconUrl?: string
  loading: boolean
  agentActive: boolean
  sessionBound: boolean
  snapshotVersion: number
}

export interface DesktopBrowserState {
  settings: DesktopBrowserSettings
  panelOpen: boolean
  loading: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  zoomFactor: number
  tabs: DesktopBrowserTabState[]
  activeTabId?: string
  viewport?: DesktopBrowserViewport
}

export interface DesktopBrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopBrowserShellSnapshot {
  dataUrl: string
  bounds: DesktopBrowserViewBounds
}

export interface DesktopBrowserHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: string
}

export interface FloatingBrowserWindowState {
  loading: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  maximized: boolean
  displayMode: BrowserDisplayMode
  zoomFactor: number
  viewport: DesktopBrowserViewport | null
  viewBounds: DesktopBrowserViewBounds | null
  tabs: DesktopBrowserTabState[]
  activeTabId?: string
}

export interface FloatingBrowserWindowBridge {
  invoke<T = void>(action: string, value?: unknown): Promise<T>
  onState(listener: (state: FloatingBrowserWindowState) => void): () => void
}

export type BrowserMenuWindowKind = BrowserMenuKind | 'context'

export interface BrowserMenuWindowPayload {
  kind: BrowserMenuWindowKind
  renderToken?: number
  state: DesktopBrowserState
  history: DesktopBrowserHistoryEntry[]
  application?: DesktopApplicationMenuState
  context?: DesktopContextMenuRequest
}

export interface BrowserMenuWindowBridge {
  invoke<T = void>(action: string, value?: unknown): Promise<T>
  selectContextMenuItem(request: DesktopContextMenuActionRequest): Promise<void>
  dismissContextMenu(requestId: string, restoreFocus?: boolean): Promise<void>
  onState(listener: (payload: BrowserMenuWindowPayload) => void): () => void
}

export type DesktopBrowserNavigationAction = 'back' | 'forward' | 'reload' | 'stop'

export interface DesktopState {
  appVersion: string
  platform: DesktopPlatform
  theme: ColorTheme
  harnessVersion?: string
  harnessUrl?: string
  harnessLoadId: number
  harnessLifecycle: HarnessLifecycle
  harnessMessage?: string
  runtimePreparationProgress?: number
  pluginFailure?: PluginInitializationFailure
  disabledPlugins: PluginRecoveryEntry[]
  updateStatus: HarnessUpdateStatus
  updateVersion?: string
  updateMessage?: string
  development: DevelopmentState
  browser: DesktopBrowserState
  isMaximized: boolean
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'
export type TitleMenuAction = 'update' | 'open-changes'

export interface DesktopBridge {
  getState(): Promise<DesktopState>
  windowAction(action: WindowAction): Promise<void>
  reportHarnessFrameLoaded(url: string): Promise<void>
  titleMenuAction(action: TitleMenuAction): Promise<void>
  checkForHarnessUpdate(): Promise<void>
  restartToApplyUpdate(): Promise<void>
  chooseDevelopmentPatch(): Promise<void>
  clearDevelopmentPatch(): Promise<void>
  restartHarnessForDevelopment(): Promise<void>
  recoverFailedPlugin(): Promise<void>
  restoreRecoveredPlugin(entryId: string): Promise<void>
  runDevelopmentPlugin(request: DevelopmentPluginRequest): Promise<void>
  setBrowserPanelOpen(open: boolean): Promise<void>
  setBrowserDisplayMode(mode: BrowserDisplayMode): Promise<void>
  openBrowserMenu(kind: BrowserMenuKind, anchor: DesktopBrowserMenuAnchor): Promise<void>
  setBrowserZoomFactor(factor: number): Promise<void>
  setBrowserDeviceViewport(viewport: DesktopBrowserViewport | null): Promise<void>
  previewBrowserDeviceViewport(viewport: DesktopBrowserViewport): Promise<void>
  setBrowserViewBounds(bounds: DesktopBrowserViewBounds | null): Promise<void>
  refreshBrowserShellSnapshot(): Promise<DesktopBrowserShellSnapshot | undefined>
  setBrowserShellOverlay(bounds: DesktopBrowserViewBounds | null): Promise<DesktopBrowserShellSnapshot | undefined>
  commitBrowserShellOverlay(): Promise<void>
  navigateBrowser(value: string): Promise<void>
  browserNavigationAction(action: DesktopBrowserNavigationAction): Promise<void>
  createBrowserTab(): Promise<void>
  selectBrowserTab(tabId: string): Promise<void>
  closeBrowserTab(tabId: string): Promise<void>
  getBrowserHistory(): Promise<DesktopBrowserHistoryEntry[]>
  clearBrowserHistory(): Promise<void>
  clearBrowserData(): Promise<void>
  selectContextMenuItem(request: DesktopContextMenuActionRequest): Promise<void>
  dismissContextMenu(requestId: string, restoreFocus?: boolean): Promise<void>
  onState(listener: (state: DesktopState) => void): () => void
  onApplicationMenuAction(listener: (action: DesktopApplicationMenuAction) => void): () => void
  onContextMenu(listener: (request: DesktopContextMenuRequest) => void): () => void
  onPointerInput(listener: (input: DesktopPointerInput) => void): () => void
}
