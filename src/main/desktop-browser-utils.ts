import type { Rectangle } from 'electron'
import type {
  BrowserAgentOpenMode,
  BrowserDisplayMode,
  DesktopBrowserHistoryEntry,
  DesktopBrowserSettings,
} from '../shared/contracts.js'

export const MAX_HISTORY_ENTRIES = 500

interface StoredHistory {
  entries?: unknown
}

export const DEFAULT_BROWSER_SETTINGS: DesktopBrowserSettings = Object.freeze({
  enabled: true,
  agentOpenMode: 'background',
  displayMode: 'split',
})

export function normalizeBrowserSettings(value: unknown): DesktopBrowserSettings {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const mode: BrowserAgentOpenMode = source.agentOpenMode === 'visible' ? 'visible' : 'background'
  const displayMode: BrowserDisplayMode = source.displayMode === 'drawer' || source.displayMode === 'floating'
    ? source.displayMode
    : 'split'
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_BROWSER_SETTINGS.enabled,
    agentOpenMode: mode,
    displayMode,
  }
}

export function normalizeBrowserAddress(value: string, allowSearch = true): string {
  const input = value.trim()
  if (input.length === 0) throw new Error('请输入网页地址。')
  if (/^https?:\/\//iu.test(input)) {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 HTTP 和 HTTPS 网页。')
    return url.href
  }
  if (/^[\w.-]+(?::\d+)?(?:\/[^\s]*)?$/u.test(input)) {
    const hostname = input.split(/[/:]/u, 1)[0]?.toLowerCase()
    const scheme = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ? 'http' : 'https'
    return new URL(`${scheme}://${input}`).href
  }
  if (!allowSearch) throw new Error('工具调用需要提供完整的 HTTP 或 HTTPS 地址。')
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`
}

export function normalizeBrowserHistory(value: unknown): DesktopBrowserHistoryEntry[] {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as StoredHistory).entries
    : undefined
  if (!Array.isArray(raw)) return []
  const entries: DesktopBrowserHistoryEntry[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (typeof source.id !== 'string' || typeof source.url !== 'string' || typeof source.title !== 'string' || typeof source.visitedAt !== 'string') continue
    if (!/^https?:\/\//iu.test(source.url) || Number.isNaN(Date.parse(source.visitedAt))) continue
    entries.push({ id: source.id, url: source.url, title: source.title, visitedAt: source.visitedAt })
    if (entries.length >= MAX_HISTORY_ENTRIES) break
  }
  return entries
}

export function positiveInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${String(minimum)}–${String(maximum)} 的整数。`)
  }
  return value
}

export function sameBounds(left: Rectangle, right: Rectangle): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
}

export function finiteCoordinate(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是有效坐标。`)
  return value
}
