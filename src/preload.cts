import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopState, DevelopmentPluginRequest, TitleMenuAction, WindowAction } from './shared/contracts.js'
import type { DesktopContextMenuActionRequest, DesktopContextMenuRequest, DesktopPointerInput } from './shared/context-menu.js'

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke('desktop:get-state') as Promise<DesktopState>,
  windowAction: (action: WindowAction) => ipcRenderer.invoke('desktop:window-action', action) as Promise<void>,
  reportHarnessFrameLoaded: (url: string) => ipcRenderer.invoke('desktop:harness-frame-loaded', url) as Promise<void>,
  titleMenuAction: (action: TitleMenuAction) => ipcRenderer.invoke('desktop:title-menu-action', action) as Promise<void>,
  checkForHarnessUpdate: () => ipcRenderer.invoke('desktop:check-update') as Promise<void>,
  restartToApplyUpdate: () => ipcRenderer.invoke('desktop:restart-update') as Promise<void>,
  chooseDevelopmentPatch: () => ipcRenderer.invoke('desktop:development-choose-patch') as Promise<void>,
  clearDevelopmentPatch: () => ipcRenderer.invoke('desktop:development-clear-patch') as Promise<void>,
  restartHarnessForDevelopment: () => ipcRenderer.invoke('desktop:development-restart') as Promise<void>,
  recoverFailedPlugin: () => ipcRenderer.invoke('desktop:plugin-recovery-disable') as Promise<void>,
  restoreRecoveredPlugin: (entryId: string) => ipcRenderer.invoke('desktop:plugin-recovery-restore', entryId) as Promise<void>,
  runDevelopmentPlugin: (request: DevelopmentPluginRequest) => ipcRenderer.invoke('desktop:development-run-plugin', request) as Promise<void>,
  selectContextMenuItem: (request: DesktopContextMenuActionRequest) => ipcRenderer.invoke('desktop:context-menu-select', request) as Promise<void>,
  dismissContextMenu: (requestId: string, restoreFocus = true) => ipcRenderer.invoke('desktop:context-menu-dismiss', requestId, restoreFocus) as Promise<void>,
  onState(listener: (state: DesktopState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState): void => listener(state)
    ipcRenderer.on('desktop:state', handler)
    return () => ipcRenderer.off('desktop:state', handler)
  },
  onContextMenu(listener: (request: DesktopContextMenuRequest) => void) {
    const handler = (_event: Electron.IpcRendererEvent, request: DesktopContextMenuRequest): void => listener(request)
    ipcRenderer.on('desktop:context-menu', handler)
    return () => ipcRenderer.off('desktop:context-menu', handler)
  },
  onPointerInput(listener: (input: DesktopPointerInput) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: DesktopPointerInput): void => listener(input)
    ipcRenderer.on('desktop:pointer-input', handler)
    return () => ipcRenderer.off('desktop:pointer-input', handler)
  },
}

contextBridge.exposeInMainWorld('desktop', bridge)
