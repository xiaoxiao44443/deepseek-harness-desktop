/// <reference types="vite/client" />

import type { DesktopBridge } from '../shared/contracts.js'

declare global {
  interface Window {
    desktop: DesktopBridge
  }
}

export {}
