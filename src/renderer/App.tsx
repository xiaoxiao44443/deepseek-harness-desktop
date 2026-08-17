import { ChevronDown, Code2, Copy, Minus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DesktopState, DevelopmentState, PluginRecoveryEntry, TitleMenuAction } from '../shared/contracts.js'
import type { ContextMenuPointerReplay, DesktopContextMenuRequest } from '../shared/context-menu.js'
import { ContextMenu } from './ContextMenu.js'
import appIconUrl from '../../app-icon.png'
import titlebarIconUrl from '../../titlebar-icon.png'

const desktopApi = window.desktop
if (desktopApi === undefined) throw new Error('Desktop preload bridge is unavailable')

type DialogPhase = 'entering' | 'leaving' | undefined

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
  const harnessFrame = useRef<HTMLIFrameElement>(null)
  const contextMenuRef = useRef<DesktopContextMenuRequest | undefined>(undefined)
  const releaseCloseButton = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    if (state === undefined) return
    document.documentElement.dataset.theme = state.theme
    document.documentElement.dataset.platform = state.platform
    document.body.classList.toggle('maximized', state.isMaximized)
  }, [state])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (developmentOpen) setDevelopmentOpen(false)
      else if (releaseNotesOpen) setReleaseNotesOpen(false)
      else if (menuOpen) setMenuOpen(false)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [developmentOpen, menuOpen, releaseNotesOpen])

  useEffect(() => { if (releaseNotesOpen) releaseCloseButton.current?.focus({ preventScroll: true }) }, [releaseNotesOpen])

  useEffect(() => {
    setStartupActionPending(false)
    setStartupActionError(undefined)
  }, [state?.harnessLoadId, state?.pluginFailure?.entryId])

  const focusHarness = useCallback(() => {
    if (state?.harnessUrl) harnessFrame.current?.focus({ preventScroll: true })
  }, [state?.harnessUrl])
  const closeMenu = useCallback(() => { setMenuOpen(false); requestAnimationFrame(focusHarness) }, [focusHarness])
  const runMenuAction = useCallback(async (action: TitleMenuAction) => {
    setMenuOpen(false)
    await desktopApi.titleMenuAction(action)
    focusHarness()
  }, [focusHarness])

  const update = useMemo(() => state === undefined ? undefined : updatePresentation(state), [state])
  const ready = state?.harnessLifecycle === 'ready'
  const preparingRuntime = state?.harnessLifecycle === 'starting' && state.harnessVersion === undefined
  const harnessUrl = state?.harnessUrl ?? ''
  const availableUpdate = state?.updateVersion !== undefined && state.updateVersion !== state.harnessVersion
  const patchEnabled = Boolean(state?.development.patchPath)
  const pluginFailure = state?.pluginFailure

  const dismissContextMenu = useCallback((restoreFocus = true, replayPointer?: ContextMenuPointerReplay): void => {
    const current = contextMenuRef.current
    contextMenuRef.current = undefined
    setContextMenu(undefined)
    if (current !== undefined) void desktopApi.dismissContextMenu(current.requestId, restoreFocus, replayPointer)
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
      <main className="content">
        {harnessUrl ? <iframe key={state?.harnessLoadId} ref={harnessFrame} id="harness-frame" name="harness-frame" className="harness-frame" title="DeepSeek Harness" allow="clipboard-read; clipboard-write" src={harnessUrl} onLoad={() => void desktopApi.reportHarnessFrameLoaded(harnessUrl)} /> : null}
        {!ready ? (
          <section className={`startup ${state?.harnessLifecycle === 'error' ? 'error' : ''}`}>
            <div className="loader" aria-hidden="true" />
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
      </main>

      <header className="titlebar">
        <button id="title-menu" className="brand" type="button" aria-label="打开应用菜单" aria-expanded={menuOpen} title="应用菜单" onClick={(event) => { event.currentTarget.blur(); setMenuOpen((open) => !open) }}>
          <span className="brand-mark-shell" aria-hidden="true"><img className="brand-mark" src={titlebarIconUrl} alt="" draggable="false" /></span><span>DeepSeek Harness</span><ChevronDown className="menu-chevron" aria-hidden="true" />
        </button>
        <div className="drag-region" aria-hidden="true" />
        <div className="window-controls" aria-hidden={state?.platform === 'macos'}>
          <button id="minimize" className="window-button" type="button" aria-label="最小化" onClick={() => void desktopApi.windowAction('minimize')}><Minus /></button>
          <button id="maximize" className="window-button" type="button" aria-label={state?.isMaximized ? '还原' : '最大化'} onClick={() => void desktopApi.windowAction('toggle-maximize')}>{state?.isMaximized ? <Copy className="restore-icon" /> : <Square className="maximize-icon" />}</button>
          <button id="close" className="window-button close" type="button" aria-label="关闭" onClick={() => void desktopApi.windowAction('close')}><X /></button>
        </div>
      </header>

      {menuOpen ? <button className="menu-backdrop" type="button" tabIndex={-1} aria-label="关闭应用菜单" onPointerDown={closeMenu} /> : null}
      {menuOpen && state !== undefined && update !== undefined ? (
        <section id="title-menu-popover" className="menu-card" role="menu" aria-label="DeepSeek Harness 应用菜单">
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
          onDismiss={(replayPointer) => dismissContextMenu(replayPointer === undefined, replayPointer)}
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
