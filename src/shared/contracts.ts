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

export interface DesktopState {
  appVersion: string
  platform: DesktopPlatform
  theme: ColorTheme
  harnessVersion?: string
  harnessUrl?: string
  harnessLifecycle: HarnessLifecycle
  harnessMessage?: string
  updateStatus: HarnessUpdateStatus
  updateVersion?: string
  updateMessage?: string
  development: DevelopmentState
  isMaximized: boolean
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'
export type NavigationAction = 'reload'
export type TitleMenuAction = 'update' | 'open-changes'

export interface DesktopBridge {
  getState(): Promise<DesktopState>
  windowAction(action: WindowAction): Promise<void>
  navigate(action: NavigationAction): Promise<void>
  reportHarnessFrameLoaded(url: string): Promise<void>
  titleMenuAction(action: TitleMenuAction): Promise<void>
  checkForHarnessUpdate(): Promise<void>
  restartToApplyUpdate(): Promise<void>
  chooseDevelopmentPatch(): Promise<void>
  clearDevelopmentPatch(): Promise<void>
  restartHarnessForDevelopment(): Promise<void>
  runDevelopmentPlugin(request: DevelopmentPluginRequest): Promise<void>
  onState(listener: (state: DesktopState) => void): () => void
}
