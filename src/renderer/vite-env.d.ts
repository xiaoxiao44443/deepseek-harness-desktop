/// <reference types="vite/client" />

import type { BrowserMenuWindowBridge, DesktopBridge, FloatingBrowserWindowBridge } from '../shared/contracts.js'

declare global {
  interface Window {
    desktop: DesktopBridge
    floatingBrowser: FloatingBrowserWindowBridge
    browserMenu: BrowserMenuWindowBridge
  }
}

export {}
