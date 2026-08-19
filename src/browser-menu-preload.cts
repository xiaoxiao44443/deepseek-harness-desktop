import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserMenuWindowBridge,
  BrowserMenuWindowPayload,
} from './shared/contracts.js'
import type { DesktopContextMenuActionRequest } from './shared/context-menu.js'

const STATE_CHANNEL = 'desktop-browser:menu-state'
const ACTION_CHANNEL = 'desktop-browser:page-menu-action'
const CONTEXT_SELECT_CHANNEL = 'desktop:context-menu-select'
const CONTEXT_DISMISS_CHANNEL = 'desktop:context-menu-dismiss'

const bridge: BrowserMenuWindowBridge = {
  invoke: async <T,>(action: string, value?: unknown): Promise<T> => {
    return await ipcRenderer.invoke(ACTION_CHANNEL, action, value) as T
  },
  selectContextMenuItem: async (request: DesktopContextMenuActionRequest): Promise<void> => {
    await ipcRenderer.invoke(CONTEXT_SELECT_CHANNEL, request)
  },
  dismissContextMenu: async (requestId: string, restoreFocus?: boolean): Promise<void> => {
    await ipcRenderer.invoke(CONTEXT_DISMISS_CHANNEL, requestId, restoreFocus)
  },
  onState: (listener: (payload: BrowserMenuWindowPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserMenuWindowPayload): void => listener(payload)
    ipcRenderer.on(STATE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(STATE_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld('browserMenu', bridge)
