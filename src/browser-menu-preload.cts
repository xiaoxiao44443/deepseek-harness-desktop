import { ipcRenderer } from 'electron'

const STATE_CHANNEL = 'desktop-browser:menu-state'
const ACTION_CHANNEL = 'desktop-browser:page-menu-action'
const CONTEXT_SELECT_CHANNEL = 'desktop:context-menu-select'
const CONTEXT_DISMISS_CHANNEL = 'desktop:context-menu-dismiss'

type MenuKind = 'application' | 'display' | 'settings' | 'context'
type DisplayMode = 'split' | 'drawer' | 'floating'
type ContextIcon = 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'select-all' | 'external-link' | 'browser' | 'link' | 'plugin' | 'archive' | 'trash' | 'edit' | 'folder' | 'settings' | 'terminal' | 'sparkles' | 'refresh'
type ContextEntry =
  | { kind: 'separator'; id: string }
  | { kind: 'item'; id: string; label: string; enabled: boolean; icon?: ContextIcon; checked?: boolean; danger?: boolean }

interface MenuPayload {
  kind: MenuKind
  renderToken?: number
  state: {
    settings: { displayMode: DisplayMode }
    url: string
    zoomFactor: number
    viewport?: { width: number; height: number }
  }
  history: Array<{ url: string; title: string }>
  application?: {
    appVersion: string
    harnessVersion?: string
    updateStatus: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error'
    updateVersion?: string
    patchEnabled: boolean
  }
  context?: { requestId: string; x: number; y: number; items: ContextEntry[] }
}

const icons = {
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  drawer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  floating: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14"/>',
  device: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/>',
  reset: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.7 8.7 10.6 10.6M8.7 15.3 19.3 4.7"/>',
  paste: '<path d="M9 5h6M9 3h6a2 2 0 0 1 2 2v2H7V5a2 2 0 0 1 2-2Z"/><path d="M9 7H5v14h14v-7M14 16h7M18 12l4 4-4 4"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M20 17a8 8 0 0 0-8-8H4"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M4 17a8 8 0 0 1 8-8h8"/>',
  selectAll: '<path d="m4 4 7.5 17 2.4-7.1L21 11.5Z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 9l3 3-3 3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
  plugin: '<path d="M8.5 3a2.5 2.5 0 1 0-5 0v5h5a2.5 2.5 0 1 1 0 5h-5v5a2.5 2.5 0 1 0 5 0v-5h5v5a2.5 2.5 0 1 0 5 0v-5h-5V8h5a2.5 2.5 0 1 0 0-5h-5v5h-5Z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.36.35.69.6 1 .27.28.62.48 1 .6h.09v4H21a1.7 1.7 0 0 0-1.6.4Z"/>',
  terminal: '<path d="m4 17 6-5-6-5M12 19h8"/>',
  sparkles: '<path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4ZM5 15l-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8ZM19 14l-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
}

const contextIcons: Record<ContextIcon, string> = {
  copy: icons.copy,
  cut: icons.cut,
  paste: icons.paste,
  undo: icons.undo,
  redo: icons.redo,
  'select-all': icons.selectAll,
  'external-link': icons.external,
  browser: icons.browser,
  link: icons.link,
  plugin: icons.plugin,
  archive: icons.archive,
  trash: icons.trash,
  edit: icons.edit,
  folder: icons.folder,
  settings: icons.settings,
  terminal: icons.terminal,
  sparkles: icons.sparkles,
  refresh: icons.refresh,
}

function svg(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root')
  if (root === null) return
  let payload: MenuPayload | undefined

  const invoke = (action: string, value?: unknown): void => {
    void ipcRenderer.invoke(ACTION_CHANNEL, action, value)
  }
  const item = (label: string, icon: string, action: () => void, checked?: boolean, disabled = false): HTMLButtonElement => {
    const button = document.createElement('button')
    button.className = 'item'
    button.type = 'button'
    button.disabled = disabled
    if (checked !== undefined) button.setAttribute('aria-checked', String(checked))
    button.innerHTML = `${svg(icon)}<span>${label}</span>${checked === true ? svg(icons.check) : '<span></span>'}`
    button.addEventListener('click', action)
    return button
  }
  const separator = (): HTMLDivElement => {
    const node = document.createElement('div')
    node.className = 'separator'
    return node
  }
  const resize = (height: number, width = 272): void => invoke('resize-menu', { width, height })

  const renderContext = (): void => {
    const context = payload?.context
    if (context === undefined) return
    root.className = ''
    root.replaceChildren()
    for (const entry of context.items) {
      if (entry.kind === 'separator') {
        root.append(separator())
        continue
      }
      const button = document.createElement('button')
      button.className = `item context-item${entry.danger === true ? ' danger' : ''}`
      button.type = 'button'
      button.disabled = !entry.enabled
      const icon = entry.checked === true ? icons.check : entry.icon === undefined ? '' : contextIcons[entry.icon]
      const iconSlot = document.createElement('span')
      if (icon.length > 0) iconSlot.innerHTML = svg(icon)
      const label = document.createElement('span')
      label.textContent = entry.label
      button.append(iconSlot, label)
      button.addEventListener('click', () => {
        void ipcRenderer.invoke(CONTEXT_SELECT_CHANNEL, { requestId: context.requestId, itemId: entry.id })
      })
      root.append(button)
    }
    requestAnimationFrame(() => resize(Math.max(40, Math.ceil(root.scrollHeight)), 212))
  }

  const renderHistory = (): void => {
    if (payload === undefined) return
    resize(360)
    root.className = ''
    root.replaceChildren()
    const head = document.createElement('div')
    head.className = 'history-head'
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'icon-button'
    back.setAttribute('aria-label', '返回浏览器设置')
    back.innerHTML = svg(icons.back)
    back.addEventListener('click', renderSettings)
    const title = document.createElement('strong')
    title.textContent = '历史记录'
    head.append(back, title, document.createElement('span'))
    const list = document.createElement('div')
    list.className = 'history-list'
    if (payload.history.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = '暂无浏览记录'
      list.append(empty)
    } else {
      for (const entry of payload.history.slice(0, 30)) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'history-entry'
        const strong = document.createElement('strong')
        strong.textContent = entry.title || entry.url
        const small = document.createElement('small')
        small.textContent = entry.url
        button.append(strong, small)
        button.addEventListener('click', () => invoke('navigate', entry.url))
        list.append(button)
      }
    }
    root.append(head, separator(), list)
  }

  const renderSettings = (): void => {
    if (payload === undefined) return
    resize(210)
    root.className = ''
    root.replaceChildren()
    root.append(
      item('历史记录', icons.history, renderHistory),
      item('清除浏览数据', icons.trash, () => invoke('clear-data')),
      separator(),
    )
    const zoom = document.createElement('div')
    zoom.className = 'zoom-row'
    zoom.innerHTML = `<span>缩放</span><button type="button" aria-label="缩小">−</button><strong>${String(Math.round(payload.state.zoomFactor * 100))}%</strong><button type="button" aria-label="放大">+</button><button type="button" aria-label="重置缩放" title="重置">${svg(icons.reset)}</button>`
    const buttons = zoom.querySelectorAll<HTMLButtonElement>('button')
    if (buttons[0] !== undefined) { buttons[0].disabled = payload.state.zoomFactor <= .5; buttons[0].addEventListener('click', () => invoke('set-zoom', payload?.state.zoomFactor === undefined ? 1 : payload.state.zoomFactor - .1)) }
    if (buttons[1] !== undefined) { buttons[1].disabled = payload.state.zoomFactor >= 2; buttons[1].addEventListener('click', () => invoke('set-zoom', payload?.state.zoomFactor === undefined ? 1 : payload.state.zoomFactor + .1)) }
    if (buttons[2] !== undefined) { buttons[2].disabled = payload.state.zoomFactor === 1; buttons[2].addEventListener('click', () => invoke('set-zoom', 1)) }
    root.append(
      zoom,
      separator(),
      item(payload.state.viewport === undefined ? '显示设备工具栏' : '隐藏设备工具栏', icons.device, () => invoke('set-device-viewport', payload?.state.viewport === undefined ? { width: 583, height: 860 } : null), undefined, payload.state.url.length === 0),
    )
  }

  const renderApplication = (): void => {
    const application = payload?.application
    if (application === undefined) return
    resize(150, 326)
    root.className = 'application'
    root.replaceChildren()
    const list = document.createElement('div')
    list.className = 'application-list'
    const applicationItem = (label: string, meta: string, action: string, options?: { disabled?: boolean; dot?: string }): HTMLButtonElement => {
      const button = document.createElement('button')
      button.className = 'item application-item'
      button.type = 'button'
      button.disabled = options?.disabled === true
      const labelNode = document.createElement('span')
      labelNode.textContent = label
      const metaNode = document.createElement('span')
      metaNode.className = 'meta'
      metaNode.textContent = meta
      const dot = document.createElement('span')
      dot.className = `dot${options?.dot === undefined ? '' : ` ${options.dot}`}`
      button.append(labelNode, metaNode, dot)
      button.addEventListener('click', () => invoke('application-action', action))
      return button
    }
    const updateStatus = application.updateStatus
    const updateTitle = updateStatus === 'ready' ? '重启并应用更新'
      : updateStatus === 'checking' ? '正在检查更新…'
        : updateStatus === 'downloading' ? '正在下载更新…'
          : updateStatus === 'error' ? '重新检查更新'
            : '检查 Harness 更新'
    const updateMeta = updateStatus === 'current' ? '已是最新'
      : updateStatus === 'error' ? '上次失败'
        : application.updateVersion ?? ''
    const updateDot = updateStatus === 'current' || updateStatus === 'ready' ? 'active ready'
      : updateStatus === 'checking' || updateStatus === 'downloading' ? 'active busy'
        : updateStatus === 'error' ? 'active error'
          : undefined
    list.append(
      applicationItem('开发工具', application.patchEnabled ? 'Patch 已启用' : 'Patch 与 Plugin', 'development'),
      applicationItem(updateTitle, updateMeta, 'update', {
        disabled: updateStatus === 'checking' || updateStatus === 'downloading',
        ...(updateDot === undefined ? {} : { dot: updateDot }),
      }),
      applicationItem('版本说明与变更记录', application.harnessVersion ?? '尚未启动', 'release-notes'),
    )
    const footer = document.createElement('footer')
    footer.className = 'application-footer'
    const footerLabel = document.createElement('span')
    footerLabel.textContent = '桌面端版本'
    const version = document.createElement('span')
    version.textContent = application.appVersion
    footer.append(footerLabel, version)
    root.append(list, footer)
  }

  const render = (): void => {
    if (payload === undefined) return
    if (payload.kind === 'context') {
      renderContext()
      return
    }
    if (payload.kind === 'application') {
      renderApplication()
      return
    }
    if (payload.kind === 'settings') {
      renderSettings()
      return
    }
    resize(116, 220)
    root.className = ''
    root.replaceChildren(
      item('分栏', icons.split, () => invoke('set-mode', 'split'), payload.state.settings.displayMode === 'split'),
      item('抽屉', icons.drawer, () => invoke('set-mode', 'drawer'), payload.state.settings.displayMode === 'drawer'),
      item('独立窗口', icons.floating, () => invoke('set-mode', 'floating'), payload.state.settings.displayMode === 'floating'),
    )
  }

  const renderAndReport = (): void => {
    render()
    const token = payload?.renderToken
    if (token === undefined) return
    requestAnimationFrame(() => requestAnimationFrame(() => invoke('menu-rendered', token)))
  }

  ipcRenderer.on(STATE_CHANNEL, (_event, next: MenuPayload) => {
    payload = next
    renderAndReport()
  })
  try {
    const initial = JSON.parse(decodeURIComponent(location.hash.slice(1))) as MenuPayload
    if (initial.kind === 'application' || initial.kind === 'display' || initial.kind === 'settings' || initial.kind === 'context') {
      payload = initial
      renderAndReport()
    }
  } catch {}
  document.addEventListener('pointerdown', (event) => {
    const target = event.target
    if (target instanceof Node && !root.contains(target)) {
      // The transparent padding around the card belongs to the child window as
      // well. Keep a secondary click alive until `contextmenu` so the main
      // process can replay it against the content underneath the shadow.
      if (event.button === 2) return
      if (payload?.kind === 'context' && payload.context !== undefined) {
        void ipcRenderer.invoke(CONTEXT_DISMISS_CHANNEL, payload.context.requestId, true)
      } else invoke('dismiss-menu')
    }
  })
  document.addEventListener('contextmenu', (event) => {
    const target = event.target
    if (!(target instanceof Node) || root.contains(target)) return
    event.preventDefault()
    invoke('reopen-context-menu', { x: event.clientX, y: event.clientY })
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (payload?.kind === 'context' && payload.context !== undefined) {
      void ipcRenderer.invoke(CONTEXT_DISMISS_CHANNEL, payload.context.requestId, true)
    } else invoke('dismiss-menu')
  })
  void ipcRenderer.invoke(ACTION_CHANNEL, 'menu-ready')
})
