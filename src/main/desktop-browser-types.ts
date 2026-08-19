import type { BrowserWindow, WebContentsView } from 'electron'
import type { BrowserMenuKind, DesktopBrowserViewport } from '../shared/contracts.js'

export type BrowserOverlayMenuKind = BrowserMenuKind | 'context'

export interface BrowserSnapshotElement {
  ref: number
  tag: string
  type: string
  role: string
  name: string
  testId: string
  placeholder: string
  value: string
  href: string
  checked: string
  expanded: string
  multiple: boolean
  options: string[]
  x: number
  y: number
  width: number
  height: number
  disabled: boolean
}

export interface BrowserSnapshot {
  url: string
  title: string
  text: string
  width: number
  height: number
  scrollX: number
  scrollY: number
  documentWidth: number
  documentHeight: number
  elements: BrowserSnapshotElement[]
}

export interface SnapshotTarget {
  x: number
  y: number
}

export type BrowserLocatorKind = 'css' | 'role' | 'text' | 'label' | 'placeholder' | 'testid' | 'nth' | 'frame' | 'filter' | 'and' | 'or'

export interface BrowserLocatorStep {
  kind: BrowserLocatorKind
  value: string
  name?: string
  exact?: boolean
}

export interface BrowserLocatorMatch {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  enabled: boolean
  innerText: string
  textContent: string | null
  attribute?: string | null
}

export interface BrowserLocatorResolution {
  count: number
  visibleCount: number
  first?: BrowserLocatorMatch
  domAction?: 'click' | 'fill' | 'type' | 'press' | 'focus' | 'set-checked'
  textContents?: string[]
  checked?: boolean
  selectedValues?: string[]
  selectedLabels?: string[]
  error?: string
}

export interface BrowserSnapshotCache {
  version: number
  url: string
  text: string
  elements: Map<number, string>
}

export type BrowserAsyncEventKind = 'filechooser' | 'download'

export interface BrowserAsyncEventWaiter {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface BrowserDownloadRuntime {
  tabId: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  completion: Promise<void>
}

export interface BrowserTabRuntime {
  id: string
  sessionId?: string
  view: WebContentsView
  hostWindow?: BrowserWindow
  loading: boolean
  url: string
  title: string
  faviconUrl?: string
  agentActive: boolean
  snapshotVersion: number
  navigationVersion: number
  snapshotTargets: Map<number, SnapshotTarget>
  lastSnapshot?: BrowserSnapshotCache
  viewport?: DesktopBrowserViewport
  backgroundViewportActive: boolean
  historyTimer: NodeJS.Timeout | undefined
  consoleLogs: Array<{ level: 'debug' | 'info' | 'log' | 'warn' | 'error'; message: string; timestamp: string; url?: string }>
  debuggerConfigured: boolean
  pendingEvents: Map<BrowserAsyncEventKind, Record<string, unknown>[]>
  eventWaiters: Map<BrowserAsyncEventKind, BrowserAsyncEventWaiter[]>
  jsDialog?: { type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'; message: string }
}

export interface DesktopBrowserAgentRequest {
  action?: unknown
  sessionId?: unknown
  tabId?: unknown
  snapshotVersion?: unknown
  url?: unknown
  visible?: unknown
  ref?: unknown
  x?: unknown
  y?: unknown
  text?: unknown
  state?: unknown
  timeoutMs?: unknown
  waitUntil?: unknown
  afterVersion?: unknown
  key?: unknown
  modifiers?: unknown
  values?: unknown
  clear?: unknown
  clickCount?: unknown
  startRef?: unknown
  startX?: unknown
  startY?: unknown
  endRef?: unknown
  endX?: unknown
  endY?: unknown
  durationMs?: unknown
  deltaX?: unknown
  deltaY?: unknown
  top?: unknown
  left?: unknown
  width?: unknown
  height?: unknown
  keep?: unknown
  locator?: unknown
  operation?: unknown
  attribute?: unknown
  value?: unknown
  checked?: unknown
  fullPage?: unknown
  clip?: unknown
  script?: unknown
  argument?: unknown
  filter?: unknown
  levels?: unknown
  limit?: unknown
  event?: unknown
  eventId?: unknown
  paths?: unknown
  accept?: unknown
  promptText?: unknown
}
