import { ipcRenderer } from 'electron'

const ACTION_CHANNEL = 'desktop-browser:floating-action'
const STATE_CHANNEL = 'desktop-browser:floating-state'

type DisplayMode = 'split' | 'drawer' | 'floating'

interface Viewport { width: number; height: number }
interface HistoryEntry { id: string; url: string; title: string; visitedAt: string }
interface FloatingBrowserState {
  loading: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  maximized: boolean
  displayMode: DisplayMode
  zoomFactor: number
  viewport: Viewport | null
  viewBounds: { x: number; y: number; width: number; height: number } | null
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing floating browser element: ${id}`)
  return element as T
}

window.addEventListener('DOMContentLoaded', () => {
  const address = byId<HTMLInputElement>('browser-address')
  const form = byId<HTMLFormElement>('browser-address-form')
  const back = byId<HTMLButtonElement>('browser-back')
  const forward = byId<HTMLButtonElement>('browser-forward')
  const reload = byId<HTMLButtonElement>('browser-reload')
  const maximize = byId<HTMLButtonElement>('window-maximize')
  const modeButton = byId<HTMLButtonElement>('browser-mode')
  const settingsButton = byId<HTMLButtonElement>('browser-settings')
  const modeMenu = byId<HTMLElement>('mode-menu')
  const settingsMenu = byId<HTMLElement>('settings-menu')
  const historyMenu = byId<HTMLElement>('history-menu')
  const historyList = byId<HTMLElement>('history-list')
  const deviceToolbar = byId<HTMLElement>('device-toolbar')
  const deviceWidth = byId<HTMLInputElement>('device-width')
  const deviceHeight = byId<HTMLInputElement>('device-height')
  const deviceOutline = byId<HTMLElement>('device-outline')
  let currentState: FloatingBrowserState | undefined

  const menuIsOpen = (): boolean => !modeMenu.hidden || !settingsMenu.hidden || !historyMenu.hidden
  const syncOverlay = (): void => { void ipcRenderer.invoke(ACTION_CHANNEL, 'overlay', menuIsOpen()) }
  const closeMenus = (): void => {
    modeMenu.hidden = true
    settingsMenu.hidden = true
    historyMenu.hidden = true
    modeButton.setAttribute('aria-expanded', 'false')
    settingsButton.setAttribute('aria-expanded', 'false')
    syncOverlay()
  }
  const toggleMenu = (menu: HTMLElement, button: HTMLButtonElement): void => {
    const open = menu.hidden
    closeMenus()
    menu.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    syncOverlay()
  }
  const setViewport = (viewport: Viewport | null): void => { void ipcRenderer.invoke(ACTION_CHANNEL, 'set-device-viewport', viewport) }
  const openMenu = (kind: 'display' | 'settings', button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    button.blur()
    void ipcRenderer.invoke(ACTION_CHANNEL, 'open-menu', {
      kind,
      anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    })
  }

  back.addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'back'))
  forward.addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'forward'))
  reload.addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'reload'))
  modeButton.addEventListener('click', () => openMenu('display', modeButton))
  settingsButton.addEventListener('click', () => openMenu('settings', settingsButton))
  byId('browser-hide').addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'hide'))
  maximize.addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'maximize'))
  form.addEventListener('submit', (event) => { event.preventDefault(); closeMenus(); void ipcRenderer.invoke(ACTION_CHANNEL, 'navigate', address.value) })

  modeMenu.querySelectorAll<HTMLElement>('[data-mode]').forEach((item) => item.addEventListener('click', () => {
    const mode = item.dataset.mode
    if (mode === 'split' || mode === 'drawer' || mode === 'floating') {
      closeMenus()
      void ipcRenderer.invoke(ACTION_CHANNEL, 'set-mode', mode)
    }
  }))

  byId('open-history').addEventListener('click', async () => {
    const entries = await ipcRenderer.invoke(ACTION_CHANNEL, 'history') as HistoryEntry[]
    historyList.replaceChildren()
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'history-empty'
      empty.textContent = '暂无浏览记录'
      historyList.append(empty)
    } else {
      entries.slice(0, 30).forEach((entry) => {
        const button = document.createElement('button')
        button.className = 'history-entry'
        const title = document.createElement('strong')
        title.textContent = entry.title || entry.url
        const url = document.createElement('small')
        url.textContent = entry.url
        button.append(title, url)
        button.addEventListener('click', () => { closeMenus(); void ipcRenderer.invoke(ACTION_CHANNEL, 'navigate', entry.url) })
        historyList.append(button)
      })
    }
    settingsMenu.hidden = true
    settingsButton.setAttribute('aria-expanded', 'false')
    historyMenu.hidden = false
    syncOverlay()
  })
  byId('history-close').addEventListener('click', closeMenus)
  byId('clear-data').addEventListener('click', () => { closeMenus(); void ipcRenderer.invoke(ACTION_CHANNEL, 'clear-data') })
  byId('zoom-out').addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'set-zoom', (currentState?.zoomFactor ?? 1) - 0.1))
  byId('zoom-in').addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'set-zoom', (currentState?.zoomFactor ?? 1) + 0.1))
  byId('zoom-reset').addEventListener('click', () => void ipcRenderer.invoke(ACTION_CHANNEL, 'set-zoom', 1))
  byId('toggle-device').addEventListener('click', () => {
    if (!currentState?.url) return
    closeMenus()
    setViewport(currentState.viewport === null ? { width: 583, height: 860 } : null)
  })
  const commitViewport = (): void => {
    const width = Math.max(240, Math.min(3840, Math.round(Number(deviceWidth.value))))
    const height = Math.max(240, Math.min(2160, Math.round(Number(deviceHeight.value))))
    if (Number.isFinite(width) && Number.isFinite(height)) setViewport({ width, height })
  }
  deviceWidth.addEventListener('change', commitViewport)
  deviceHeight.addEventListener('change', commitViewport)
  byId('device-rotate').addEventListener('click', () => setViewport({ width: Number(deviceHeight.value), height: Number(deviceWidth.value) }))
  byId('device-close').addEventListener('click', () => setViewport(null))
  deviceOutline.querySelectorAll<HTMLElement>('[data-direction]').forEach((handle) => handle.addEventListener('pointerdown', (event) => {
    const viewport = currentState?.viewport
    const viewBounds = currentState?.viewBounds
    const direction = handle.dataset.direction ?? ''
    if (viewport === null || viewport === undefined || viewBounds === null || viewBounds === undefined) return
    event.preventDefault()
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const chrome = document.querySelector<HTMLElement>('.chrome')
    const maxWidth = Math.max(240, Math.floor(window.innerWidth - 72))
    const maxHeight = Math.max(240, Math.floor(window.innerHeight - (chrome?.offsetHeight ?? 0) - deviceToolbar.offsetHeight - 72))
    const startWidth = Math.min(viewport.width, maxWidth)
    const startHeight = Math.min(viewport.height, maxHeight)
    const scale = Math.max(.1, viewBounds.width / viewport.width)
    let nextWidth = startWidth
    let nextHeight = startHeight
    let frame = 0
    const commit = (): void => { frame = 0; setViewport({ width: Math.max(240, Math.min(maxWidth, Math.round(nextWidth))), height: Math.max(240, Math.min(maxHeight, Math.round(nextHeight))) }) }
    const move = (pointer: PointerEvent): void => {
      const dx = (pointer.clientX - startX) / scale
      const dy = (pointer.clientY - startY) / scale
      if (direction.includes('e')) nextWidth = startWidth + dx
      if (direction.includes('w')) nextWidth = startWidth - dx
      if (direction.includes('s')) nextHeight = startHeight + dy
      if (direction.includes('n')) nextHeight = startHeight - dy
      if (frame === 0) frame = requestAnimationFrame(commit)
    }
    const finish = (): void => {
      if (frame !== 0) { cancelAnimationFrame(frame); commit() }
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }))
  document.addEventListener('pointerdown', (event) => {
    void ipcRenderer.invoke(ACTION_CHANNEL, 'dismiss-menu')
    const target = event.target
    if (!(target instanceof Node)) return
    if (modeMenu.contains(target) || settingsMenu.contains(target) || historyMenu.contains(target) || modeButton.contains(target) || settingsButton.contains(target)) return
    if (menuIsOpen()) closeMenus()
  })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus() })

  ipcRenderer.on(STATE_CHANNEL, (_event, state: FloatingBrowserState) => {
    const deviceModeChanged = currentState !== undefined && (currentState.viewport === null) !== (state.viewport === null)
    currentState = state
    if (document.activeElement !== address) address.value = state.url
    back.disabled = !state.canGoBack
    forward.disabled = !state.canGoForward
    reload.classList.toggle('loading', state.loading)
    reload.setAttribute('aria-label', state.loading ? '停止加载' : '重新加载')
    maximize.classList.toggle('maximized', state.maximized)
    maximize.setAttribute('aria-label', state.maximized ? '还原窗口' : '最大化窗口')
    if (document.activeElement === maximize) maximize.blur()
    modeButton.dataset.mode = state.displayMode
    modeMenu.querySelectorAll<HTMLElement>('[data-mode]').forEach((item) => item.setAttribute('aria-checked', String(item.dataset.mode === state.displayMode)))
    byId('browser-tab-title').textContent = state.url ? state.title || state.url : '新标签页'
    document.title = state.title && state.url ? `${state.title} - DeepSeek Harness 浏览器` : 'DeepSeek Harness 浏览器'
    const zoom = Math.round(state.zoomFactor * 100)
    byId('zoom-value').textContent = `${String(zoom)}%`
    byId('device-zoom').textContent = `${String(zoom)}%`
    byId<HTMLButtonElement>('zoom-out').disabled = state.zoomFactor <= 0.5
    byId<HTMLButtonElement>('zoom-in').disabled = state.zoomFactor >= 2
    byId<HTMLButtonElement>('zoom-reset').disabled = state.zoomFactor === 1
    const toggleDevice = byId<HTMLButtonElement>('toggle-device')
    toggleDevice.disabled = !state.url
    toggleDevice.setAttribute('aria-checked', String(state.viewport !== null))
    deviceToolbar.hidden = state.viewport === null
    deviceOutline.hidden = state.viewport === null || state.viewBounds === null
    if (state.viewBounds !== null) {
      deviceOutline.style.left = `${String(state.viewBounds.x)}px`
      deviceOutline.style.top = `${String(state.viewBounds.y)}px`
      deviceOutline.style.width = `${String(state.viewBounds.width)}px`
      deviceOutline.style.height = `${String(state.viewBounds.height)}px`
    }
    if (state.viewport !== null) {
      if (document.activeElement !== deviceWidth) deviceWidth.value = String(state.viewport.width)
      if (document.activeElement !== deviceHeight) deviceHeight.value = String(state.viewport.height)
    }
    if (deviceModeChanged && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
  })

  void ipcRenderer.invoke(ACTION_CHANNEL, 'ready')
})
