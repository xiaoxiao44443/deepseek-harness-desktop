import { ArrowLeft, ArrowRight, Check, ChevronDown, Code2, Columns2, Copy, Globe2, History, Maximize2, Minimize2, Minus, MonitorSmartphone, MoreVertical, PanelRight, Plus, RotateCw, Square, TabletSmartphone, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BrowserDisplayMode, DesktopApplicationMenuAction, DesktopBrowserHistoryEntry, DesktopBrowserShellSnapshot, DesktopBrowserViewport, DesktopState, DevelopmentState, PluginRecoveryEntry, TitleMenuAction } from '../shared/contracts.js'
import type { DesktopContextMenuRequest } from '../shared/context-menu.js'
import { ContextMenu } from './ContextMenu.js'
import appIconUrl from '../../app-icon.png'
import titlebarIconUrl from '../../titlebar-icon.png'

const desktopApi = window.desktop
if (desktopApi === undefined) throw new Error('Desktop preload bridge is unavailable')
const BROWSER_DEVICE_FRAME_GUTTER = 12
const BROWSER_DEVICE_STAGE_GUTTER = 36
const BROWSER_DEVICE_TOTAL_GUTTER = (BROWSER_DEVICE_FRAME_GUTTER + BROWSER_DEVICE_STAGE_GUTTER) * 2

type DialogPhase = 'entering' | 'leaving' | undefined

interface BrowserShellSnapshotImage {
  dataUrl: string
  left: number
  top: number
  width: number
  height: number
}

function FloatingWindowIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" /><rect width="10" height="7" x="12" y="13" rx="2" /></svg>
}

function BrowserPanelIcon({ open }: { open: boolean }): ReactNode {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />{open ? <path d="M14.5 4.5v15" strokeLinecap="square" /> : <path d="M17.25 8.5v7" />}</svg>
}

function AgentPointerIcon({ id }: { id: string }): ReactNode {
  const gradientId = `agent-pointer-${id.replaceAll(/[^a-z0-9_-]/giu, '-')}`
  return <svg className="browser-agent-pointer" width="15" height="19" viewBox="0 0 24 30" fill="none" aria-label="Agent 正在操作">
    <defs><linearGradient id={gradientId} x1="3" y1="2" x2="17" y2="25" gradientUnits="userSpaceOnUse"><stop stopColor="#9edbff" /><stop offset=".48" stopColor="#5b8cff" /><stop offset="1" stopColor="#8a63ff" /></linearGradient></defs>
    <path d="M2.7 1.9v20.2l5.15-4.86 3.65 8.42 4.06-1.76-3.58-8.27 7.36-.2L2.7 1.9Z" fill={`url(#${gradientId})`} stroke="white" strokeWidth="1.45" strokeLinejoin="round" />
  </svg>
}

function usePresence(open: boolean, exitDuration = 130): { mounted: boolean; phase: DialogPhase } {
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<DialogPhase>(open ? 'entering' : undefined)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      setMounted(true)
      setPhase('entering')
      timer = setTimeout(() => setPhase(undefined), 180)
    } else if (mounted) {
      setPhase('leaving')
      timer = setTimeout(() => {
        setMounted(false)
        setPhase(undefined)
      }, exitDuration)
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [exitDuration, mounted, open])

  return { mounted, phase }
}

function updatePresentation(state: DesktopState): {
  title: string
  detail: string
  dotClass: string
  disabled: boolean
} {
  const result = {
    title: '检查 Harness 更新',
    detail: '',
    dotClass: 'item-dot',
    disabled: state.updateStatus === 'checking' || state.updateStatus === 'downloading',
  }
  if (state.updateStatus === 'ready') {
    return { ...result, title: '重启并应用更新', detail: state.updateVersion ?? '', dotClass: 'item-dot active ready' }
  }
  if (state.updateStatus === 'checking') {
    return { ...result, title: '正在检查更新…', dotClass: 'item-dot active busy' }
  }
  if (state.updateStatus === 'downloading') {
    return { ...result, title: '正在下载更新…', detail: state.updateVersion ?? '', dotClass: 'item-dot active busy' }
  }
  if (state.updateStatus === 'error') {
    return { ...result, title: '重新检查更新', detail: '上次失败', dotClass: 'item-dot active error' }
  }
  if (state.updateStatus === 'current') {
    return { ...result, detail: '已是最新', dotClass: 'item-dot active ready' }
  }
  return result
}

interface ModalProps {
  open: boolean
  className?: string
  labelledBy: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}

function Modal({ open, className = '', labelledBy, closeLabel, onClose, children }: ModalProps): ReactNode {
  const presence = usePresence(open)
  if (!presence.mounted) return null
  const phaseClass = presence.phase ?? ''
  return (
    <>
      <button className={`dialog-backdrop ${phaseClass}`} type="button" tabIndex={-1} aria-label={closeLabel} onPointerDown={onClose} />
      <section className={`app-dialog ${className} ${phaseClass}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </>
  )
}

function DevelopmentPanel({
  open,
  state,
  disabledPlugins,
  harnessReady,
  onClose,
}: {
  open: boolean
  state: DevelopmentState
  disabledPlugins: PluginRecoveryEntry[]
  harnessReady: boolean
  onClose: () => void
}): ReactNode {
  const [profile, setProfile] = useState('')
  const [argumentsText, setArgumentsText] = useState('')
  const [actionError, setActionError] = useState<string>()
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true })
  }, [open])

  const runAction = useCallback(async (action: () => Promise<void>, closeOnSuccess = false) => {
    setActionError(undefined)
    try {
      await action()
      if (closeOnSuccess) onClose()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [onClose])

  const patchPath = state.patchPath ?? ''
  const commandOutput = actionError ?? state.commandOutput
  const commandFailed = actionError !== undefined || (state.lastExitCode !== undefined && state.lastExitCode !== 0)
  const commandPreview = `dsh plugin --profile ${profile.trim() || '<name>'} ${argumentsText.trim() || '<args…>'}`

  return (
    <Modal open={open} className="development-dialog" labelledBy="development-title" closeLabel="关闭开发工具" onClose={onClose}>
      <header className="dialog-header">
        <div className="dialog-heading">
          <span className="development-icon" aria-hidden="true"><Code2 /></span>
          <div><h2 id="development-title">Harness 开发工具</h2><p>桌面操作与 Harness 内部共享同一套 dsh 和 pnpm</p></div>
        </div>
        <button ref={closeButton} className="dialog-close" type="button" aria-label="关闭开发工具" title="关闭" onClick={onClose}><X /></button>
      </header>
      <div className="dialog-content development-content">
        <div className="runtime-badges" aria-label="开发运行时版本">
          <span><strong>dsh</strong><span>{state.dshVersion ?? '尚未启动'}</span></span>
          <span><strong>pnpm</strong><span>{state.pnpmVersion}</span></span>
        </div>

        <section className="development-section">
          <div className="section-heading"><div><h3>Patch 配置</h3><p>等价于 <code>dsh web --patch &lt;配置文件&gt;</code>，重启 Harness 后生效。</p></div></div>
          <div className="patch-picker">
            <div className={`path-value ${patchPath ? '' : 'empty'}`} title={patchPath}>{patchPath || '未选择 Patch 配置'}</div>
            <button className="compact-button" type="button" disabled={state.restarting} onClick={() => void runAction(() => desktopApi.chooseDevelopmentPatch())}>选择文件</button>
            <button className="compact-button subtle" type="button" disabled={!patchPath || state.restarting} onClick={() => void runAction(() => desktopApi.clearDevelopmentPatch())}>清除</button>
          </div>
          <div className="section-actions"><button className="dialog-button primary" type="button" disabled={state.restarting} onClick={() => void runAction(() => desktopApi.restartHarnessForDevelopment(), true)}>{state.restarting ? '正在重启…' : patchPath ? '重启并应用' : '重启 Harness'}</button></div>
        </section>

        {disabledPlugins.length > 0 ? (
          <section className="development-section">
            <div className="section-heading"><div><h3>插件恢复</h3><p>这些插件因初始化失败被桌面端临时禁用；修复后可重新启用并重启 Harness。</p></div></div>
            <div className="recovered-plugin-list">
              {disabledPlugins.map((plugin) => (
                <div className="recovered-plugin-row" key={plugin.entryId}>
                  <div><strong>{plugin.pluginName}</strong><code>{plugin.entryId}</code></div>
                  <button className="compact-button" type="button" disabled={state.restarting} onClick={() => void runAction(() => desktopApi.restoreRecoveredPlugin(plugin.entryId), true)}>重新启用并重启</button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="development-section">
          <div className="section-heading"><div><h3>Plugin 命令</h3><p>运行 <code>dsh plugin --profile &lt;名称&gt; &lt;pnpm 参数…&gt;</code>。</p></div></div>
          <div className="command-fields">
            <label><span>Profile</span><input value={profile} onChange={(event) => setProfile(event.target.value)} type="text" autoComplete="off" spellCheck="false" placeholder="例如 default" /></label>
            <label className="arguments-field"><span>pnpm 参数</span><input value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} type="text" autoComplete="off" spellCheck="false" placeholder="例如 add ./scratch-plugin" /></label>
            <button className="dialog-button" type="button" disabled={state.commandRunning || !harnessReady} onClick={() => void runAction(() => desktopApi.runDevelopmentPlugin({ profile, argumentsText }))}>{state.commandRunning ? '运行中…' : '运行'}</button>
          </div>
          <div className="command-preview">{commandPreview}</div>
          {commandOutput ? <pre className={`command-output ${commandFailed ? 'error' : ''}`}>{commandOutput}</pre> : null}
        </section>

        <p className="development-note">创造模式仍由 Harness 内置预设管理；在 Harness 中直接选择即可。相同的 dsh/pnpm 命令也可在 Harness 终端中运行。</p>
      </div>
      <footer className="dialog-actions"><button className="dialog-button secondary" type="button" onClick={onClose}>完成</button></footer>
    </Modal>
  )
}

export function App(): ReactNode {
  const [state, setState] = useState<DesktopState>()
  const [menuOpen, setMenuOpen] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)
  const [developmentOpen, setDevelopmentOpen] = useState(false)
  const [startupActionPending, setStartupActionPending] = useState(false)
  const [startupActionError, setStartupActionError] = useState<string>()
  const [contextMenu, setContextMenu] = useState<DesktopContextMenuRequest>()
  const [browserAddress, setBrowserAddress] = useState('')
  const [browserAddressFocused, setBrowserAddressFocused] = useState(false)
  const [browserHistoryOpen, setBrowserHistoryOpen] = useState(false)
  const [browserHistory, setBrowserHistory] = useState<DesktopBrowserHistoryEntry[]>([])
  const [browserDisplayMenuOpen, setBrowserDisplayMenuOpen] = useState(false)
  const [browserSettingsMenuOpen, setBrowserSettingsMenuOpen] = useState(false)
  const [browserShellSnapshot, setBrowserShellSnapshot] = useState<BrowserShellSnapshotImage>()
  const [browserShellOverlayActive, setBrowserShellOverlayActive] = useState(false)
  const [shellMenuPresentationPending, setShellMenuPresentationPending] = useState(false)
  const [browserWidth, setBrowserWidth] = useState(() => {
    const stored = Number(localStorage.getItem('desktop.browser.width'))
    return Number.isFinite(stored) && stored >= 360 ? stored : 620
  })
  const [browserExpanded, setBrowserExpanded] = useState(false)
  const harnessFrame = useRef<HTMLIFrameElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const browserViewHost = useRef<HTMLDivElement>(null)
  const browserSurfaceRef = useRef<HTMLDivElement>(null)
  const [browserSurfaceSize, setBrowserSurfaceSize] = useState({ width: 0, height: 0 })
  const [browserDevicePreview, setBrowserDevicePreview] = useState<DesktopBrowserViewport | undefined>(undefined)
  const browserNormalWidth = useRef(browserWidth)
  const contextMenuRef = useRef<DesktopContextMenuRequest | undefined>(undefined)
  const releaseCloseButton = useRef<HTMLButtonElement>(null)
  const shellOverlaySequence = useRef(0)
  const browserShellSnapshotRef = useRef<BrowserShellSnapshotImage | undefined>(undefined)
  const browserShellSnapshotGeneration = useRef(0)

  useEffect(() => {
    let disposed = false
    const unsubscribe = desktopApi.onState((nextState) => { if (!disposed) setState(nextState) })
    void desktopApi.getState().then((nextState) => { if (!disposed) setState(nextState) })
    return () => { disposed = true; unsubscribe() }
  }, [])

  useEffect(() => desktopApi.onContextMenu((request) => {
    contextMenuRef.current = request
    setContextMenu(request)
    setMenuOpen(false)
  }), [])

  useEffect(() => desktopApi.onApplicationMenuAction((action: DesktopApplicationMenuAction) => {
    setMenuOpen(false)
    if (action === 'development') setDevelopmentOpen(true)
    else if (action === 'release-notes') setReleaseNotesOpen(true)
  }), [])

  useEffect(() => desktopApi.onPointerInput(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    if (target === null || target.closest('#title-menu, #title-menu-popover') === null) setMenuOpen(false)

    const current = contextMenuRef.current
    if (current !== undefined && (target === null || target.closest('.context-menu-card') === null)) {
      contextMenuRef.current = undefined
      setContextMenu(undefined)
      void desktopApi.dismissContextMenu(current.requestId, false)
    }
  }), [])

  useEffect(() => {
    if (state === undefined) return
    document.documentElement.dataset.theme = state.theme
    document.documentElement.dataset.platform = state.platform
    document.body.classList.toggle('maximized', state.isMaximized)
  }, [state])

  useEffect(() => {
    if (!browserAddressFocused) setBrowserAddress(state?.browser.url ?? '')
  }, [browserAddressFocused, state?.browser.url])

  useEffect(() => {
    if (state?.browser.panelOpen === false) {
      setBrowserHistoryOpen(false)
      setBrowserDisplayMenuOpen(false)
      setBrowserSettingsMenuOpen(false)
      setBrowserWidth(browserNormalWidth.current)
      setBrowserExpanded(false)
    }
  }, [state?.browser.panelOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (developmentOpen) setDevelopmentOpen(false)
      else if (releaseNotesOpen) setReleaseNotesOpen(false)
      else if (menuOpen) setMenuOpen(false)
      else if (browserDisplayMenuOpen) setBrowserDisplayMenuOpen(false)
      else if (browserSettingsMenuOpen) setBrowserSettingsMenuOpen(false)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [browserDisplayMenuOpen, browserSettingsMenuOpen, developmentOpen, menuOpen, releaseNotesOpen])

  useEffect(() => { if (releaseNotesOpen) releaseCloseButton.current?.focus({ preventScroll: true }) }, [releaseNotesOpen])

  useEffect(() => {
    setStartupActionPending(false)
    setStartupActionError(undefined)
  }, [state?.harnessLoadId, state?.pluginFailure?.entryId])

  const focusHarness = useCallback(() => {
    if (state?.harnessUrl) harnessFrame.current?.focus({ preventScroll: true })
  }, [state?.harnessUrl])
  const runMenuAction = useCallback(async (action: TitleMenuAction) => {
    setMenuOpen(false)
    await desktopApi.titleMenuAction(action)
    focusHarness()
  }, [focusHarness])

  const update = useMemo(() => state === undefined ? undefined : updatePresentation(state), [state])
  const ready = state?.harnessLifecycle === 'ready'
  const preparingRuntime = state?.harnessLifecycle === 'starting' && state.harnessVersion === undefined
  const runtimePreparationProgress = preparingRuntime ? state?.runtimePreparationProgress : undefined
  const harnessUrl = state?.harnessUrl ?? ''
  const availableUpdate = state?.updateVersion !== undefined && state.updateVersion !== state.harnessVersion
  const patchEnabled = Boolean(state?.development.patchPath)
  const pluginFailure = state?.pluginFailure
  const browserOpen = state?.browser.panelOpen === true && state.browser.settings.enabled
  const browserDisplayMode: BrowserDisplayMode = state?.browser.settings.displayMode ?? 'split'
  const browserModalOpen = releaseNotesOpen || developmentOpen
  const browserPanelOpen = browserOpen && browserDisplayMode !== 'floating'
  const browserMenuOpen = browserDisplayMenuOpen || browserSettingsMenuOpen
  const browserDisplayModeLabel = browserDisplayMode === 'split' ? '分栏' : browserDisplayMode === 'drawer' ? '抽屉' : '独立窗口'
  const browserViewport = state?.browser.viewport
  const renderedBrowserViewport = browserDevicePreview ?? browserViewport
  const browserDeviceMaxWidth = Math.max(240, Math.floor(browserSurfaceSize.width - BROWSER_DEVICE_TOTAL_GUTTER))
  const browserDeviceMaxHeight = Math.max(240, Math.floor(browserSurfaceSize.height - BROWSER_DEVICE_TOTAL_GUTTER))
  const browserDeviceScale = renderedBrowserViewport === undefined || browserSurfaceSize.width === 0 || browserSurfaceSize.height === 0
    ? 1
    : Math.max(0.1, Math.min(
      1,
      browserDeviceMaxWidth / renderedBrowserViewport.width,
      browserDeviceMaxHeight / renderedBrowserViewport.height,
    ))
  const browserDeviceRenderedHeight = renderedBrowserViewport === undefined
    ? 0
    : Math.max(1, Math.min(browserDeviceMaxHeight, Math.round(renderedBrowserViewport.height * browserDeviceScale)))

  useEffect(() => {
    if (!browserModalOpen || !browserOpen) return
    void desktopApi.setBrowserPanelOpen(false)
  }, [browserModalOpen, browserOpen])

  useEffect(() => {
    if (browserViewport === undefined) setBrowserDevicePreview(undefined)
    else setBrowserDevicePreview((preview) => preview?.width === browserViewport.width && preview.height === browserViewport.height ? undefined : preview)
  }, [browserViewport?.height, browserViewport?.width])

  useEffect(() => {
    setBrowserExpanded(false)
    if (browserDisplayMode !== 'floating') setBrowserWidth(browserNormalWidth.current)
  }, [browserDisplayMode])

  useEffect(() => {
    const surface = browserSurfaceRef.current
    if (surface === null) return
    const report = (): void => setBrowserSurfaceSize({ width: surface.clientWidth, height: surface.clientHeight })
    const observer = new ResizeObserver(report)
    observer.observe(surface)
    report()
    return () => observer.disconnect()
  }, [browserPanelOpen, state?.browser.viewport])

  useEffect(() => {
    const host = browserViewHost.current
    const surface = browserSurfaceRef.current
    if (!browserPanelOpen || browserHistoryOpen || browserModalOpen || !state?.browser.url || host === null) {
      void desktopApi.setBrowserViewBounds(null)
      return
    }
    let frame = 0
    const report = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) {
          void desktopApi.setBrowserViewBounds(null)
          return
        }
        void desktopApi.setBrowserViewBounds({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })
      })
    }
    const observer = new ResizeObserver(report)
    observer.observe(host)
    if (surface !== null) observer.observe(surface)
    window.addEventListener('resize', report)
    report()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [browserHistoryOpen, browserModalOpen, browserPanelOpen, state?.browser.url, state?.browser.viewport?.height, state?.browser.viewport?.width])

  const clearBrowserShellSnapshot = useCallback(() => {
    browserShellSnapshotGeneration.current += 1
    browserShellSnapshotRef.current = undefined
    setBrowserShellSnapshot(undefined)
    setBrowserShellOverlayActive(false)
  }, [])

  const prepareBrowserShellSnapshot = useCallback(async (snapshot: DesktopBrowserShellSnapshot, generation = browserShellSnapshotGeneration.current): Promise<BrowserShellSnapshotImage | undefined> => {
    const alreadyDecoded = browserShellSnapshotRef.current?.dataUrl === snapshot.dataUrl
    if (!alreadyDecoded) {
      const decoded = await new Promise<boolean>((resolve) => {
        const image = new Image()
        image.onload = () => resolve(true)
        image.onerror = () => resolve(false)
        image.src = snapshot.dataUrl
      })
      if (!decoded) return undefined
    }
    if (generation !== browserShellSnapshotGeneration.current) return undefined
    const host = browserViewHost.current
    if (host === null) return undefined
    const hostRect = host.getBoundingClientRect()
    const prepared = {
      dataUrl: snapshot.dataUrl,
      left: snapshot.bounds.x - hostRect.x,
      top: snapshot.bounds.y - hostRect.y,
      width: snapshot.bounds.width,
      height: snapshot.bounds.height,
    }
    if (generation !== browserShellSnapshotGeneration.current) return undefined
    browserShellSnapshotRef.current = prepared
    setBrowserShellSnapshot(prepared)
    return prepared
  }, [])

  useEffect(() => {
    if (!browserPanelOpen || browserHistoryOpen || browserModalOpen || !state?.browser.url) {
      clearBrowserShellSnapshot()
      return
    }
    const generation = ++browserShellSnapshotGeneration.current
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      const snapshot = await desktopApi.refreshBrowserShellSnapshot().catch(() => undefined)
      if (!disposed && snapshot !== undefined) await prepareBrowserShellSnapshot(snapshot, generation)
      if (!disposed) timer = setTimeout(() => void refresh(), 1000)
    }
    void refresh()
    return () => {
      disposed = true
      if (browserShellSnapshotGeneration.current === generation) clearBrowserShellSnapshot()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [browserHistoryOpen, browserModalOpen, browserPanelOpen, clearBrowserShellSnapshot, prepareBrowserShellSnapshot, state?.browser.url, state?.browser.viewport?.height, state?.browser.viewport?.width])

  useLayoutEffect(() => {
    const sequence = ++shellOverlaySequence.current
    const menuVisible = menuOpen || contextMenu !== undefined || browserMenuOpen
    if (!menuVisible) {
      setShellMenuPresentationPending(false)
      setBrowserShellOverlayActive(false)
      void desktopApi.setBrowserShellOverlay(null)
      return
    }
    setShellMenuPresentationPending(true)
    queueMicrotask(() => {
      if (shellOverlaySequence.current !== sequence) return
      const menus = [...document.querySelectorAll<HTMLElement>('#title-menu-popover, .context-menu-card')]
        .filter((element) => element.offsetWidth > 0 && element.offsetHeight > 0)
      if (menus.length === 0) {
        setShellMenuPresentationPending(false)
        setBrowserShellOverlayActive(false)
        void desktopApi.setBrowserShellOverlay(null)
        return
      }
      const rects = menus.map((element) => element.getBoundingClientRect())
      const left = Math.min(...rects.map((rect) => rect.left))
      const top = Math.min(...rects.map((rect) => rect.top))
      const right = Math.max(...rects.map((rect) => rect.right))
      const bottom = Math.max(...rects.map((rect) => rect.bottom))
      const host = browserViewHost.current
      if (host === null) {
        setShellMenuPresentationPending(false)
        setBrowserShellOverlayActive(false)
        void desktopApi.setBrowserShellOverlay(null)
        return
      }
      const hostRect = host.getBoundingClientRect()
      const overlapsBrowser = left < hostRect.right && right > hostRect.left && top < hostRect.bottom && bottom > hostRect.top
      if (!overlapsBrowser) {
        setShellMenuPresentationPending(false)
        setBrowserShellOverlayActive(false)
        void desktopApi.setBrowserShellOverlay(null)
        return
      }
      void desktopApi.refreshBrowserShellSnapshot()
        .then((snapshot) => snapshot === undefined ? undefined : prepareBrowserShellSnapshot(snapshot))
        .catch(() => undefined)
      void desktopApi.setBrowserShellOverlay({ x: left, y: top, width: right - left, height: bottom - top }).then(async (snapshot) => {
        if (shellOverlaySequence.current !== sequence) return
        if (snapshot === undefined) {
          setShellMenuPresentationPending(false)
          return
        }
        const prepared = await prepareBrowserShellSnapshot(snapshot)
        if (prepared === undefined || shellOverlaySequence.current !== sequence) {
          setShellMenuPresentationPending(false)
          return
        }
        setBrowserShellOverlayActive(true)
        await desktopApi.commitBrowserShellOverlay()
        requestAnimationFrame(() => {
          if (shellOverlaySequence.current === sequence) setShellMenuPresentationPending(false)
        })
      }).catch(() => {
        if (shellOverlaySequence.current === sequence) setShellMenuPresentationPending(false)
      })
    })
  }, [browserDisplayMenuOpen, browserSettingsMenuOpen, contextMenu, menuOpen, prepareBrowserShellSnapshot])

  useEffect(() => {
    const content = contentRef.current
    if (!browserPanelOpen || content === null) return
    const resize = (): void => {
      if (browserExpanded) {
        setBrowserWidth(content.clientWidth)
      } else {
        const reserved = browserDisplayMode === 'split' ? 360 : 48
        const maxNormal = Math.max(360, content.clientWidth - reserved)
        setBrowserWidth((current) => Math.min(maxNormal, Math.max(360, current)))
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(content)
    resize()
    return () => observer.disconnect()
  }, [browserDisplayMode, browserExpanded, browserPanelOpen])

  const startBrowserResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const content = contentRef.current
    if (content === null || browserExpanded || browserDisplayMode === 'floating') return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    let frame = 0
    let pendingWidth = browserNormalWidth.current
    const commit = (): void => {
      frame = 0
      browserNormalWidth.current = pendingWidth
      setBrowserWidth(pendingWidth)
    }
    const move = (pointer: PointerEvent): void => {
      const rect = content.getBoundingClientRect()
      const reserved = browserDisplayMode === 'split' ? 360 : 48
      pendingWidth = Math.min(Math.max(360, rect.width - reserved), Math.max(360, rect.right - pointer.clientX))
      if (frame === 0) frame = requestAnimationFrame(commit)
    }
    const finish = (): void => {
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        commit()
      }
      localStorage.setItem('desktop.browser.width', String(Math.round(pendingWidth)))
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [browserDisplayMode, browserExpanded])

  const toggleBrowserExpanded = useCallback(() => {
    const content = contentRef.current
    if (content === null) return
    if (browserExpanded) {
      if (browserDisplayMode !== 'floating') setBrowserWidth(browserNormalWidth.current)
      setBrowserExpanded(false)
      return
    }
    if (browserDisplayMode !== 'floating') browserNormalWidth.current = browserWidth
    setBrowserWidth(content.clientWidth)
    setBrowserExpanded(true)
  }, [browserDisplayMode, browserExpanded, browserWidth])

  const openBrowserHistory = useCallback(async () => {
    setBrowserDisplayMenuOpen(false)
    setBrowserSettingsMenuOpen(false)
    setBrowserHistory(await desktopApi.getBrowserHistory())
    setBrowserHistoryOpen(true)
  }, [])

  const navigateBrowser = useCallback(async (value: string) => {
    const address = value.trim()
    if (address.length === 0) return
    setBrowserHistoryOpen(false)
    await desktopApi.navigateBrowser(address)
  }, [])

  const selectBrowserDisplayMode = useCallback(async (mode: BrowserDisplayMode) => {
    setBrowserDisplayMenuOpen(false)
    await desktopApi.setBrowserDisplayMode(mode)
  }, [])

  const setDeviceViewport = useCallback((width: number, height: number) => {
    void desktopApi.setBrowserDeviceViewport({
      width: Math.max(240, Math.min(3840, Math.round(width))),
      height: Math.max(240, Math.min(2160, Math.round(height))),
    })
  }, [])

  const openBrowserMenu = useCallback((kind: 'display' | 'settings', _target: HTMLButtonElement) => {
    if (kind === 'display') { setBrowserSettingsMenuOpen(false); setBrowserDisplayMenuOpen((open) => !open) }
    else { setBrowserDisplayMenuOpen(false); setBrowserSettingsMenuOpen((open) => !open) }
  }, [])

  const startDeviceResize = useCallback((event: React.PointerEvent<HTMLDivElement>, direction: string) => {
    const viewport = state?.browser.viewport
    if (viewport === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const scale = Math.max(0.1, browserDeviceScale)
    const maxWidth = Math.min(3840, Math.max(240, Math.floor(browserDeviceMaxWidth / scale)))
    const maxHeight = Math.min(2160, Math.max(240, Math.floor(browserDeviceMaxHeight / scale)))
    const startWidth = Math.min(viewport.width, maxWidth)
    const startHeight = Math.min(viewport.height, maxHeight)
    const frameElement = handle.closest<HTMLElement>('.browser-device-frame')
    let nextWidth = startWidth
    let nextHeight = startHeight
    let frame = 0
    const preview = (): void => {
      frame = 0
      const viewport = {
        width: Math.max(240, Math.min(maxWidth, Math.round(nextWidth))),
        height: Math.max(240, Math.min(maxHeight, Math.round(nextHeight))),
      }
      if (frameElement !== null) {
        frameElement.style.width = `${String(Math.round(viewport.width * scale) + BROWSER_DEVICE_FRAME_GUTTER * 2)}px`
        frameElement.style.height = `${String(Math.max(1, Math.min(browserDeviceMaxHeight, Math.round(viewport.height * scale))) + BROWSER_DEVICE_FRAME_GUTTER * 2)}px`
      }
      void desktopApi.previewBrowserDeviceViewport(viewport)
    }
    const move = (pointer: PointerEvent): void => {
      // The device frame is centered in the stage, so changing its size moves
      // each edge by half of the total delta. Compensate for that geometry so
      // the active handle follows the pointer one-for-one.
      const dx = ((pointer.clientX - startX) * 2) / scale
      const dy = ((pointer.clientY - startY) * 2) / scale
      if (direction.includes('e')) nextWidth = startWidth + dx
      if (direction.includes('w')) nextWidth = startWidth - dx
      if (direction.includes('s')) nextHeight = startHeight + dy
      if (direction.includes('n')) nextHeight = startHeight - dy
      if (frame === 0) frame = requestAnimationFrame(preview)
    }
    const finish = (): void => {
      if (frame !== 0) { cancelAnimationFrame(frame); preview() }
      const width = Math.max(240, Math.min(maxWidth, Math.round(nextWidth)))
      const height = Math.max(240, Math.min(maxHeight, Math.round(nextHeight)))
      setBrowserDevicePreview({ width, height })
      void desktopApi.setBrowserDeviceViewport({ width, height })
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [browserDeviceMaxHeight, browserDeviceMaxWidth, browserDeviceScale, state?.browser.viewport])

  const dismissContextMenu = useCallback((restoreFocus = true): void => {
    const current = contextMenuRef.current
    contextMenuRef.current = undefined
    setContextMenu(undefined)
    if (current !== undefined) void desktopApi.dismissContextMenu(current.requestId, restoreFocus)
  }, [])

  const selectContextMenuItem = useCallback((itemId: string): void => {
    const current = contextMenuRef.current
    if (current === undefined) return
    contextMenuRef.current = undefined
    setContextMenu(undefined)
    void desktopApi.selectContextMenuItem({
      requestId: current.requestId,
      itemId,
    })
  }, [])

  useEffect(() => {
    contextMenuRef.current = undefined
    setContextMenu(undefined)
  }, [state?.harnessLoadId, state?.harnessUrl])

  useEffect(() => {
    if (contextMenu === undefined) return
    const onWindowBlur = (): void => dismissContextMenu(false)
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [contextMenu, dismissContextMenu])

  const runStartupAction = async (action: () => Promise<void>): Promise<void> => {
    if (startupActionPending) return
    setStartupActionPending(true)
    setStartupActionError(undefined)
    try {
      await action()
    } catch (error) {
      setStartupActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setStartupActionPending(false)
    }
  }

  return (
    <>
      <main ref={contentRef} className="content">
        <section className="harness-pane">
          {harnessUrl ? <iframe key={state?.harnessLoadId} ref={harnessFrame} id="harness-frame" name="harness-frame" className="harness-frame" title="DeepSeek Harness" allow="clipboard-read; clipboard-write" src={harnessUrl} onLoad={() => void desktopApi.reportHarnessFrameLoaded(harnessUrl)} /> : null}
        {!ready ? (
          <section className={`startup ${state?.harnessLifecycle === 'error' ? 'error' : ''}`}>
            {runtimePreparationProgress !== undefined ? (
              <div
                className="startup-progress"
                role="progressbar"
                aria-label="Harness 运行时解压进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={runtimePreparationProgress}
              >
                <span className="startup-progress-value">{runtimePreparationProgress}</span>
                <span className="startup-progress-unit">%</span>
              </div>
            ) : <div className="loader" aria-hidden="true" />}
            <h1 id="startup-title">{pluginFailure ? 'Harness 插件初始化失败' : state?.harnessLifecycle === 'error' ? 'DeepSeek Harness 启动失败' : preparingRuntime ? '正在准备 DeepSeek Harness' : '正在启动 DeepSeek Harness'}</h1>
            <p id="startup-message">{state?.harnessMessage ?? '正在准备本地 Harness 服务…'}</p>
            {pluginFailure ? (
              <div className="plugin-recovery-actions">
                <p>可以先临时禁用 <strong>{pluginFailure.pluginName}</strong>，让 Harness 恢复启动。修好插件后可在“开发工具 → 插件恢复”中重新启用。</p>
                {pluginFailure.recoverable ? (
                  <button className="secondary-button recovery-button" type="button" disabled={startupActionPending} onClick={() => void runStartupAction(() => desktopApi.recoverFailedPlugin())}>
                    {startupActionPending ? '正在禁用并重启…' : '临时禁用该插件并重启'}
                  </button>
                ) : <p className="startup-action-error">这个内置桥接插件不能自动禁用，请重新安装桌面应用。</p>}
                {startupActionError ? <p className="startup-action-error" role="alert">{startupActionError}</p> : null}
              </div>
            ) : state?.harnessLifecycle === 'error' ? <button className="secondary-button" type="button" onClick={() => void desktopApi.checkForHarnessUpdate()}>重新检查更新</button> : null}
          </section>
        ) : null}
        </section>
        {browserPanelOpen ? (
          <aside className={`browser-pane mode-${browserDisplayMode}${browserExpanded ? ' expanded' : ''}`} style={browserExpanded ? undefined : { width: browserWidth }} aria-label="内置浏览器">
            {browserExpanded ? null : <div className="browser-resizer" role="separator" aria-orientation="vertical" onPointerDown={startBrowserResize} />}
            <header className="browser-chrome">
              <div className="browser-tabbar">
                <div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
                  {state?.browser.tabs.map((tab) => {
                    const label = tab.url ? tab.title || tab.url : tab.sessionBound ? 'Agent 浏览器' : '新标签页'
                    const selected = state.browser.activeTabId === tab.id
                    return <div key={tab.id} className={`browser-tab${selected ? ' active' : ''}`} title={label}>
                      <button className="browser-tab-main" type="button" role="tab" aria-selected={selected} onClick={() => void desktopApi.selectBrowserTab(tab.id)}>
                        {tab.loading ? <RotateCw className="browser-tab-loading" aria-label="正在加载" /> : <span className="browser-tab-favicon" aria-hidden="true"><Globe2 />{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true }} /> : null}</span>}<span className="browser-tab-title">{label}</span>{tab.agentActive ? <AgentPointerIcon id={tab.id} /> : null}
                      </button>
                      <button className="browser-tab-close" type="button" aria-label={`关闭 ${label}`} onClick={(event) => { event.stopPropagation(); void desktopApi.closeBrowserTab(tab.id) }}><X /></button>
                    </div>
                  })}
                  <button className="browser-new-tab" type="button" aria-label="新增标签页" title="新增标签页" onClick={() => void desktopApi.createBrowserTab()}><Plus /></button>
                </div>
                <div className="browser-panel-actions">
                  <button type="button" aria-label={browserExpanded ? '恢复面板宽度' : '展开面板'} title={browserExpanded ? '恢复面板宽度' : '展开面板'} onClick={toggleBrowserExpanded}>{browserExpanded ? <Minimize2 /> : <Maximize2 />}</button>
                  <button type="button" aria-label={`显示方式：${browserDisplayModeLabel}`} aria-expanded={browserDisplayMenuOpen} title={`显示方式：${browserDisplayModeLabel}`} onClick={(event) => openBrowserMenu('display', event.currentTarget)}>
                    {browserDisplayMode === 'split' ? <Columns2 /> : browserDisplayMode === 'drawer' ? <PanelRight /> : <FloatingWindowIcon />}
                  </button>
                  <button type="button" aria-label="隐藏浏览器" title="隐藏浏览器" onClick={() => void desktopApi.setBrowserPanelOpen(false)}><X /></button>
                </div>
              </div>
              <div className="browser-toolbar">
              <div className="browser-navigation">
                <button type="button" aria-label="后退" disabled={!state?.browser.canGoBack} onClick={() => void desktopApi.browserNavigationAction('back')}><ArrowLeft /></button>
                <button type="button" aria-label="前进" disabled={!state?.browser.canGoForward} onClick={() => void desktopApi.browserNavigationAction('forward')}><ArrowRight /></button>
                <button type="button" aria-label={state?.browser.loading ? '停止加载' : '重新加载'} onClick={() => void desktopApi.browserNavigationAction(state?.browser.loading ? 'stop' : 'reload')}><RotateCw className={state?.browser.loading ? 'browser-loading' : ''} /></button>
              </div>
              <form className="browser-address" onSubmit={(event) => { event.preventDefault(); void navigateBrowser(browserAddress) }}>
                <Globe2 aria-hidden="true" />
                <input value={browserAddress} aria-label="网页地址" placeholder="输入网址或搜索内容" spellCheck={false} onFocus={() => setBrowserAddressFocused(true)} onBlur={() => setBrowserAddressFocused(false)} onChange={(event) => setBrowserAddress(event.target.value)} />
              </form>
              <div className="browser-actions">
                <button type="button" aria-label="浏览器设置" aria-expanded={browserSettingsMenuOpen} onClick={(event) => openBrowserMenu('settings', event.currentTarget)}><MoreVertical /></button>
              </div>
              </div>
            </header>
            {state?.browser.viewport ? (
              <div className="browser-device-toolbar">
                <strong>尺寸:</strong><span>响应式</span>
                <input key={`width-${String(state.browser.viewport.width)}`} type="number" min={240} max={3840} defaultValue={state.browser.viewport.width} aria-label="设备宽度" onBlur={(event) => setDeviceViewport(Number(event.currentTarget.value), state.browser.viewport?.height ?? 860)} />
                <span>×</span>
                <input key={`height-${String(state.browser.viewport.height)}`} type="number" min={240} max={2160} defaultValue={state.browser.viewport.height} aria-label="设备高度" onBlur={(event) => setDeviceViewport(state.browser.viewport?.width ?? 583, Number(event.currentTarget.value))} />
                <button type="button" aria-label="旋转设备" title="旋转设备" onClick={() => setDeviceViewport(state.browser.viewport?.height ?? 860, state.browser.viewport?.width ?? 583)}><TabletSmartphone /></button>
                <span>{Math.round((state.browser.zoomFactor ?? 1) * 100)}%</span>
                <button className="device-toolbar-close" type="button" aria-label="关闭设备工具栏" title="关闭设备工具栏" onClick={() => void desktopApi.setBrowserDeviceViewport(null)}><X /></button>
              </div>
            ) : null}
            {browserMenuOpen ? (
              <div className={`browser-menu-layer${shellMenuPresentationPending ? ' shell-overlay-pending' : ''}${browserShellOverlayActive ? ' shell-overlay-synchronized' : ''}`} onPointerDown={() => { setBrowserDisplayMenuOpen(false); setBrowserSettingsMenuOpen(false) }}>
                {browserDisplayMenuOpen ? (
                  <div className="context-menu-card browser-popover display-popover" role="menu" aria-label="浏览器显示方式" onPointerDown={(event) => event.stopPropagation()}>
                    {([
                      ['split', '分栏', <Columns2 key="split" />],
                      ['drawer', '抽屉', <PanelRight key="drawer" />],
                      ['floating', '独立窗口', <FloatingWindowIcon key="floating" />],
                    ] as const).map(([mode, label, icon]) => (
                      <button key={mode} className="context-menu-item browser-mode-item" type="button" role="menuitemradio" aria-checked={browserDisplayMode === mode} onClick={() => void selectBrowserDisplayMode(mode)}>
                        <span className="context-menu-icon">{icon}</span><span className="context-menu-label">{label}</span>{browserDisplayMode === mode ? <Check className="browser-menu-check" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {browserSettingsMenuOpen ? (
                  <div className="context-menu-card browser-popover settings-popover" role="menu" aria-label="浏览器设置" onPointerDown={(event) => event.stopPropagation()}>
                    <button className="context-menu-item" type="button" role="menuitem" onClick={() => void openBrowserHistory()}><span className="context-menu-icon"><History /></span><span className="context-menu-label">历史记录</span></button>
                    <button className="context-menu-item" type="button" role="menuitem" onClick={() => { setBrowserSettingsMenuOpen(false); void desktopApi.clearBrowserData() }}><span className="context-menu-icon"><Trash2 /></span><span className="context-menu-label">清除浏览数据</span></button>
                    <div className="context-menu-separator" />
                    <div className="browser-zoom-row" role="group" aria-label="网页缩放">
                      <span>缩放</span>
                      <button type="button" aria-label="缩小" disabled={(state?.browser.zoomFactor ?? 1) <= 0.5} onClick={() => void desktopApi.setBrowserZoomFactor((state?.browser.zoomFactor ?? 1) - 0.1)}><Minus /></button>
                      <strong>{Math.round((state?.browser.zoomFactor ?? 1) * 100)}%</strong>
                      <button type="button" aria-label="放大" disabled={(state?.browser.zoomFactor ?? 1) >= 2} onClick={() => void desktopApi.setBrowserZoomFactor((state?.browser.zoomFactor ?? 1) + 0.1)}><Plus /></button>
                      <button type="button" aria-label="重置缩放" title="重置" disabled={(state?.browser.zoomFactor ?? 1) === 1} onClick={() => void desktopApi.setBrowserZoomFactor(1)}><RotateCw /></button>
                    </div>
                    <div className="context-menu-separator" />
                    <button className="context-menu-item" type="button" role="menuitem" disabled={!state?.browser.url} onClick={() => {
                      setBrowserSettingsMenuOpen(false)
                      void desktopApi.setBrowserDeviceViewport(state?.browser.viewport ? null : { width: 583, height: 860 })
                    }}>
                      <span className="context-menu-icon"><MonitorSmartphone /></span><span className="context-menu-label">{state?.browser.viewport ? '隐藏设备工具栏' : '显示设备工具栏'}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div ref={browserSurfaceRef} className={`browser-surface${browserViewport ? ' device-active' : ''}${browserShellOverlayActive ? ' shell-overlay-active' : ''}`}>
              {browserHistoryOpen ? (
                <section className="browser-history" aria-label="浏览历史">
                  <header><button className="browser-history-back" type="button" aria-label="返回网页" onClick={() => setBrowserHistoryOpen(false)}><ArrowLeft /></button><div><h2>浏览历史</h2><p>仅保存在这台设备的内置浏览器中</p></div><button type="button" disabled={browserHistory.length === 0} onClick={() => void desktopApi.clearBrowserHistory().then(() => setBrowserHistory([]))}>清除</button></header>
                  <div className="browser-history-list">
                    {browserHistory.length === 0 ? <p className="browser-empty">暂无浏览记录</p> : browserHistory.map((entry) => (
                      <button key={entry.id} type="button" onClick={() => void navigateBrowser(entry.url)}>
                        <Globe2 aria-hidden="true" /><span><strong>{entry.title}</strong><small>{entry.url}</small></span><time>{new Date(entry.visitedAt).toLocaleString()}</time>
                      </button>
                    ))}
                  </div>
                </section>
              ) : state?.browser.url && renderedBrowserViewport ? (
                <div className="browser-device-stage">
                  <div className="browser-device-frame" style={{ width: Math.round(renderedBrowserViewport.width * browserDeviceScale) + BROWSER_DEVICE_FRAME_GUTTER * 2, height: browserDeviceRenderedHeight + BROWSER_DEVICE_FRAME_GUTTER * 2 }}>
                    <div ref={browserViewHost} className="browser-view-host">
                      {browserShellSnapshot ? <img className="browser-shell-snapshot" src={browserShellSnapshot.dataUrl} alt="" aria-hidden="true" style={{ left: browserShellSnapshot.left, top: browserShellSnapshot.top, width: browserShellSnapshot.width, height: browserShellSnapshot.height }} /> : null}
                    </div>
                    {['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map((direction) => <div key={direction} className={`device-resize-handle ${direction}`} onPointerDown={(event) => startDeviceResize(event, direction)} />)}
                  </div>
                </div>
              ) : state?.browser.url ? <div ref={browserViewHost} className="browser-view-host">
                {browserShellSnapshot ? <img className="browser-shell-snapshot" src={browserShellSnapshot.dataUrl} alt="" aria-hidden="true" style={{ left: browserShellSnapshot.left, top: browserShellSnapshot.top, width: browserShellSnapshot.width, height: browserShellSnapshot.height }} /> : null}
              </div> : (
                <section className="browser-welcome"><Globe2 aria-hidden="true" /><h2>内置浏览器</h2><p>在上方输入网址，或让 Agent 在后台打开网页。</p></section>
              )}
            </div>
          </aside>
        ) : null}
      </main>

      <header className="titlebar">
        <button id="title-menu" className="brand" type="button" aria-label="打开应用菜单" aria-expanded={menuOpen} title="应用菜单" onClick={(event) => {
          event.currentTarget.blur()
          setMenuOpen((open) => !open)
        }}>
          <span className="brand-mark-shell" aria-hidden="true"><img className="brand-mark" src={titlebarIconUrl} alt="" draggable="false" /></span><span>DeepSeek Harness</span><ChevronDown className="menu-chevron" aria-hidden="true" />
        </button>
        <div className="drag-region" aria-hidden="true" />
        {state?.browser.settings.enabled ? (
          <button className="titlebar-browser-button" type="button" aria-label={browserOpen ? '隐藏浏览器侧栏' : '显示浏览器侧栏'} aria-pressed={browserOpen} onClick={() => void desktopApi.setBrowserPanelOpen(!browserOpen)}>
            <BrowserPanelIcon open={browserOpen} />
          </button>
        ) : null}
        <div className="window-controls" aria-hidden={state?.platform === 'macos'}>
          <button id="minimize" className="window-button" type="button" aria-label="最小化" onClick={() => void desktopApi.windowAction('minimize')}><Minus /></button>
          <button id="maximize" className="window-button" type="button" aria-label={state?.isMaximized ? '还原' : '最大化'} onClick={() => void desktopApi.windowAction('toggle-maximize')}>{state?.isMaximized ? <Copy className="restore-icon" /> : <Square className="maximize-icon" />}</button>
          <button id="close" className="window-button close" type="button" aria-label="关闭" onClick={() => void desktopApi.windowAction('close')}><X /></button>
        </div>
      </header>

      {menuOpen && state !== undefined && update !== undefined ? (
        <section id="title-menu-popover" className={`menu-card${shellMenuPresentationPending ? ' shell-overlay-pending' : ''}${browserShellOverlayActive ? ' shell-overlay-synchronized' : ''}`} role="menu" aria-label="DeepSeek Harness 应用菜单">
          <div className="menu-list">
            <button id="development-action" className="menu-item" type="button" role="menuitem" onClick={(event) => { event.currentTarget.blur(); setMenuOpen(false); setDevelopmentOpen(true) }}><span className="item-label">开发工具</span><span className="item-meta">{patchEnabled ? 'Patch 已启用' : 'Patch 与 Plugin'}</span><span className="item-dot" aria-hidden="true" /></button>
            <button id="update-action" className="menu-item" type="button" role="menuitem" disabled={update.disabled} onClick={(event) => { event.currentTarget.blur(); void runMenuAction('update') }}><span id="update-title" className="item-label">{update.title}</span><span className="item-meta">{update.detail}</span><span className={update.dotClass} aria-hidden="true" /></button>
            <button className="menu-item" type="button" role="menuitem" onClick={(event) => { event.currentTarget.blur(); setMenuOpen(false); setReleaseNotesOpen(true) }}><span className="item-label">版本说明与变更记录</span><span className="item-meta">{state.harnessVersion ?? '尚未启动'}</span></button>
          </div>
          <footer className="menu-footer"><span>桌面端版本</span><span id="version-label">{state.appVersion}</span></footer>
        </section>
      ) : null}

      {contextMenu === undefined ? null : (
        <ContextMenu
          menu={contextMenu}
          onSelect={selectContextMenuItem}
          presentationPending={shellMenuPresentationPending}
          presentationSynchronized={browserShellOverlayActive}
        />
      )}

      <Modal open={releaseNotesOpen} labelledBy="release-notes-title" closeLabel="关闭版本说明" onClose={() => { setReleaseNotesOpen(false); requestAnimationFrame(focusHarness) }}>
        <header className="dialog-header">
          <div className="dialog-heading"><img className="dialog-icon" src={appIconUrl} alt="" aria-hidden="true" draggable="false" /><div><h2 id="release-notes-title">版本说明</h2><p>DeepSeek Harness Desktop</p></div></div>
          <button ref={releaseCloseButton} className="dialog-close" type="button" aria-label="关闭版本说明" title="关闭" onClick={() => setReleaseNotesOpen(false)}><X /></button>
        </header>
        <div className="dialog-content">
          <dl className="version-list"><div><dt>当前 Harness</dt><dd>{state?.harnessVersion ?? '尚未启动'}</dd></div><div><dt>桌面端</dt><dd>{state?.appVersion ?? '—'}</dd></div>{availableUpdate ? <div><dt>可用更新</dt><dd>{state?.updateVersion}</dd></div> : null}</dl>
          <p className="dialog-note">{state?.updateMessage || '官方当前未提供独立 Release Notes，可查看仓库的版本变更记录。'}</p>
        </div>
        <footer className="dialog-actions"><button className="dialog-button secondary" type="button" onClick={() => setReleaseNotesOpen(false)}>关闭</button><button className="dialog-button primary" type="button" onClick={(event) => { event.currentTarget.blur(); void desktopApi.titleMenuAction('open-changes') }}>查看官方变更记录</button></footer>
      </Modal>

      {state !== undefined ? <DevelopmentPanel open={developmentOpen} state={state.development} disabledPlugins={state.disabledPlugins} harnessReady={ready} onClose={() => { setDevelopmentOpen(false); requestAnimationFrame(focusHarness) }} /> : null}
    </>
  )
}
