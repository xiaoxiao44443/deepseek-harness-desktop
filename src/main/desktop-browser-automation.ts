import type {
  BrowserLocatorKind,
  BrowserLocatorMatch,
  BrowserLocatorResolution,
  BrowserLocatorStep,
  BrowserTabRuntime,
  DesktopBrowserAgentRequest,
  SnapshotTarget,
} from './desktop-browser-types.js'
import { finiteCoordinate, positiveInteger } from './desktop-browser-utils.js'

export type BrowserDebuggerCommand = (
  tab: BrowserTabRuntime,
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>

export type BrowserSnapshotReader = (tab: BrowserTabRuntime) => Promise<Record<string, unknown>>

const LOCATOR_KINDS = new Set<BrowserLocatorKind>([
  'css', 'role', 'text', 'label', 'placeholder', 'testid', 'nth', 'frame', 'filter', 'and', 'or',
])

export function parseLocatorPlan(request: DesktopBrowserAgentRequest): BrowserLocatorStep[] {
  if (!Array.isArray(request.locator) || request.locator.length === 0) throw new Error('locator 必须是非空定位步骤数组。')
  if (request.locator.length > 12) throw new Error('locator 定位步骤过多。')
  return request.locator.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('locator 定位步骤格式无效。')
    const source = entry as Record<string, unknown>
    if (typeof source.kind !== 'string' || !LOCATOR_KINDS.has(source.kind as BrowserLocatorKind)) throw new Error('locator 定位类型无效。')
    if (typeof source.value !== 'string' || source.value.length === 0 || source.value.length > 1_000) throw new Error('locator 定位值无效。')
    if (source.kind === 'nth' && !/^-?\d+$/u.test(source.value)) throw new Error('locator nth 索引无效。')
    if (source.kind === 'filter' || source.kind === 'and' || source.kind === 'or') {
      try {
        const decoded = JSON.parse(source.value) as unknown
        if (source.kind === 'filter') {
          if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error()
          const options = decoded as Record<string, unknown>
          if (options.hasText !== undefined && typeof options.hasText !== 'string') throw new Error()
          if (options.hasNotText !== undefined && typeof options.hasNotText !== 'string') throw new Error()
        } else if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > 12) throw new Error()
      } catch {
        throw new Error(`locator ${String(source.kind)} 配置无效。`)
      }
    }
    if (source.exact !== undefined && typeof source.exact !== 'boolean') throw new Error('locator exact 必须是布尔值。')
    if (source.name !== undefined && (typeof source.name !== 'string' || source.name.length === 0 || source.name.length > 500)) {
      throw new Error('locator name 无效。')
    }
    return {
      kind: source.kind as BrowserLocatorKind,
      value: source.value,
      ...(typeof source.name === 'string' ? { name: source.name } : {}),
      ...(source.exact === true ? { exact: true } : {}),
    }
  })
}

export function strictLocator(resolution: BrowserLocatorResolution): BrowserLocatorMatch {
  if (resolution.count === 0) throw new Error('Locator 没有匹配到元素，请刷新 DOM 快照并重新构造定位器。')
  if (resolution.count > 1) throw new Error(`Locator 严格模式失败：匹配到 ${String(resolution.count)} 个元素。`)
  if (resolution.first === undefined) throw new Error('Locator 无法读取匹配元素。')
  return resolution.first
}

export function targetFromRequest(tab: BrowserTabRuntime, request: DesktopBrowserAgentRequest): SnapshotTarget {
  if (typeof request.ref === 'number') {
    const ref = positiveInteger(request.ref, 'ref', 1, Number.MAX_SAFE_INTEGER)
    const snapshotVersion = positiveInteger(request.snapshotVersion, 'snapshotVersion', 1, Number.MAX_SAFE_INTEGER)
    if (snapshotVersion !== tab.snapshotVersion) throw new Error('这个元素引用已失效，请重新调用 browser_snapshot。')
    const target = tab.snapshotTargets.get(ref)
    if (target === undefined) throw new Error('这个元素引用已失效，请重新调用 browser_snapshot。')
    return target
  }
  return { x: finiteCoordinate(request.x, 'x'), y: finiteCoordinate(request.y, 'y') }
}

export function readConsoleLogs(tab: BrowserTabRuntime, request: DesktopBrowserAgentRequest): Record<string, unknown> {
  if (request.filter !== undefined && typeof request.filter !== 'string') throw new Error('filter 必须是字符串。')
  if (request.levels !== undefined && (!Array.isArray(request.levels) || request.levels.some((level) => !['debug', 'info', 'log', 'warn', 'warning', 'error'].includes(String(level))))) {
    throw new Error('levels 包含不支持的日志等级。')
  }
  const limit = request.limit === undefined ? 100 : positiveInteger(request.limit, 'limit', 1, 500)
  const levels = request.levels === undefined
    ? undefined
    : new Set((request.levels as unknown[]).map((level) => level === 'warning' ? 'warn' : String(level)))
  const filter = typeof request.filter === 'string' ? request.filter.toLocaleLowerCase() : undefined
  const logs = tab.consoleLogs.filter((entry) => (levels === undefined || levels.has(entry.level))
    && (filter === undefined || entry.message.toLocaleLowerCase().includes(filter))).slice(-limit)
  return { ok: true, tabId: tab.id, logs }
}

export async function waitForPage(
  tab: BrowserTabRuntime,
  request: DesktopBrowserAgentRequest,
  debuggerCommand: BrowserDebuggerCommand,
  snapshot: BrowserSnapshotReader,
): Promise<Record<string, unknown>> {
  const text = request.text
  if (text !== undefined && (typeof text !== 'string' || text.length === 0)) throw new Error('text 必须是非空字符串。')
  const state = request.state === undefined ? 'visible' : request.state
  if (state !== 'visible' && state !== 'hidden') throw new Error('state 必须是 visible 或 hidden。')
  const timeoutMs = request.timeoutMs === undefined ? 10_000 : positiveInteger(request.timeoutMs, 'timeoutMs', 250, 30_000)
  const deadline = Date.now() + timeoutMs
  const earliestSuccess = Date.now() + 180
  let readyState = 'loading'
  let textMatched = text === undefined
  while (Date.now() <= deadline) {
    if (tab.view.webContents.isDestroyed()) throw new Error('浏览器标签页已关闭。')
    try {
      const response = await debuggerCommand(tab, 'Runtime.evaluate', {
        expression: `(() => ({ readyState: document.readyState, textMatched: ${text === undefined ? 'true' : `String(document.body?.innerText || '').includes(${JSON.stringify(text)})`} }))()`,
        returnByValue: true,
        awaitPromise: true,
      }) as { result?: { value?: { readyState?: unknown; textMatched?: unknown } } }
      const value = response.result?.value
      readyState = typeof value?.readyState === 'string' ? value.readyState : 'loading'
      textMatched = value?.textMatched === true
      const textReady = text === undefined || (state === 'visible' ? textMatched : !textMatched)
      if (Date.now() >= earliestSuccess && !tab.loading && readyState !== 'loading' && textReady) {
        const result = await snapshot(tab)
        return { ...result, waited: { text: text ?? null, state, timeoutMs } }
      }
    } catch {
      readyState = 'loading'
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
  }
  const condition = text === undefined ? '页面完成加载' : `文本“${text}”变为${state === 'visible' ? '可见' : '不可见'}`
  throw new Error(`等待${condition}超时（${String(timeoutMs)}ms）。`)
}

export async function waitForNavigation(
  tab: BrowserTabRuntime,
  request: DesktopBrowserAgentRequest,
  requireNavigation: boolean,
  debuggerCommand: BrowserDebuggerCommand,
): Promise<Record<string, unknown>> {
  const timeoutMs = request.timeoutMs === undefined ? 30_000 : positiveInteger(request.timeoutMs, 'timeoutMs', 250, 60_000)
  const afterVersion = requireNavigation ? positiveInteger(request.afterVersion, 'afterVersion', 0, Number.MAX_SAFE_INTEGER) : undefined
  const expectedUrl = request.url
  if (expectedUrl !== undefined && (typeof expectedUrl !== 'string' || expectedUrl.length === 0 || expectedUrl.length > 4_000)) {
    throw new Error('url 必须是非空字符串。')
  }
  const waitUntil = request.waitUntil === undefined ? 'load' : request.waitUntil
  if (!['commit', 'domcontentloaded', 'load', 'networkidle'].includes(String(waitUntil))) {
    throw new Error('waitUntil 必须是 commit、domcontentloaded、load 或 networkidle。')
  }
  const urlMatches = (actual: string): boolean => {
    if (expectedUrl === undefined) return true
    const escaped = expectedUrl.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*')
    return new RegExp(`^${escaped}$`, 'u').test(actual)
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const current = tab.view.webContents.getURL()
    const navigationReady = afterVersion === undefined || tab.navigationVersion > afterVersion
    if (navigationReady && urlMatches(current)) {
      if (waitUntil === 'commit') return { ok: true, tabId: tab.id, url: current, version: tab.navigationVersion, waitUntil }
      const response = await debuggerCommand(tab, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      }).catch(() => undefined) as { result?: { value?: unknown } } | undefined
      const readyState = response?.result?.value
      const stateReady = waitUntil === 'domcontentloaded'
        ? readyState === 'interactive' || readyState === 'complete'
        : readyState === 'complete' && !tab.loading
      if (stateReady) return { ok: true, tabId: tab.id, url: current, version: tab.navigationVersion, waitUntil }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  const target = expectedUrl === undefined ? '下一次导航' : `URL ${expectedUrl}`
  throw new Error(`等待${target}超时（${String(timeoutMs)}ms）。`)
}

export async function evaluatePage(
  tab: BrowserTabRuntime,
  request: DesktopBrowserAgentRequest,
  debuggerCommand: BrowserDebuggerCommand,
): Promise<Record<string, unknown>> {
  if (typeof request.script !== 'string' || request.script.trim().length === 0 || request.script.length > 8_000) {
    throw new Error('evaluate script 必须是 1–8000 字符的字符串。')
  }
  const forbidden = /(?:\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\b(?:localStorage|sessionStorage|indexedDB|caches)\b|\b(?:location|history)\s*\.|\.\s*(?:click|focus|blur|submit|remove|append|appendChild|prepend|replaceWith|setAttribute|removeAttribute|dispatchEvent)\s*\(|\.(?:innerHTML|outerHTML|textContent|value|checked)\s*=)/u
  if (forbidden.test(request.script)) throw new Error('evaluate 只允许只读页面检查，脚本包含可能修改页面或发起网络请求的操作。')
  let argument: string
  try {
    argument = JSON.stringify(request.argument ?? null)
  } catch {
    throw new Error('evaluate argument 必须可 JSON 序列化。')
  }
  if (argument.length > 32_000) throw new Error('evaluate argument 过大。')
  const source = request.script.trim()
  const callable = /^(?:async\s*)?(?:function\b|\(?\s*[A-Za-z_$][\w$]*(?:\s*,[^)]*)?\)?\s*=>|\(.*\)\s*=>)/su.test(source)
  const expression = callable
    ? `Promise.resolve((${source})(${argument}))`
    : `Promise.resolve((${source}))`
  const timeoutMs = request.timeoutMs === undefined ? 5_000 : positiveInteger(request.timeoutMs, 'timeoutMs', 250, 15_000)
  const result = await Promise.race([
    debuggerCommand(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`evaluate 超时（${String(timeoutMs)}ms）。`)), timeoutMs)),
  ]) as { result?: { value?: unknown; unserializableValue?: unknown; description?: unknown }; exceptionDetails?: unknown }
  if (result.exceptionDetails !== undefined) throw new Error(`evaluate 执行失败：${String(result.result?.description ?? '页面脚本异常')}`)
  if (result.result?.unserializableValue !== undefined) throw new Error('evaluate 结果无法 JSON 序列化。')
  return { ok: true, tabId: tab.id, value: result.result?.value ?? null }
}
