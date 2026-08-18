export const name = 'desktop-browser'
export const inject = ['tools', 'skills', 'webServer']

const SETTINGS_PATH = '/api/dsh-desktop/browser/settings'
const HISTORY_PATH = '/api/dsh-desktop/browser/history'
const CLEAR_DATA_PATH = '/api/dsh-desktop/browser/clear-data'
const MAX_PROXY_BODY_BYTES = 65_536

export const BROWSER_SKILL = `Use the DeepSeek Harness Desktop built-in browser for interactive web work.

Workflow:
1. Call browser_open with a complete http:// or https:// URL. It opens in the background unless the user asks to see it or the visible panel would materially help.
2. Call browser_snapshot before interacting. Element refs belong only to the latest snapshot and become stale after navigation or DOM changes.
3. Prefer ref-based browser_click and browser_type. Use coordinates only when the snapshot cannot identify the target.
4. Call browser_snapshot again after every navigation or significant interaction.
5. Use browser_set_viewport only when responsive layout or a requested viewport matters. Reset it after the temporary check.
6. Use browser_show to reveal or hide the panel. Never claim a hidden background page is visible to the user.
7. Do not bypass authentication, permission prompts, CAPTCHAs, or site safety controls. Ask the user to take over when human interaction is required.

The desktop browser has an isolated persistent browsing profile. Downloads and website permission requests are disabled. browser_screenshot returns a local PNG path when pixel inspection is necessary.`

function endpoint(controlUrl, pathname) {
  const value = new URL(controlUrl)
  value.pathname = pathname
  value.search = ''
  value.hash = ''
  return value
}

async function desktopRequest(controlUrl, controlToken, pathname, options = {}) {
  const response = await fetch(endpoint(controlUrl, pathname), {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`
    throw new Error(`Desktop browser request failed: ${message}`)
  }
  return payload
}

function browserTool(name, description, properties, required, action, controlUrl, controlToken) {
  return {
    name,
    description: `${description} Follow the desktop-browser Skill before using browser tools.`,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: value }] },
    },
    async execute(args) {
      const result = await desktopRequest(controlUrl, controlToken, '/v1/browser/action', {
        method: 'POST',
        body: { action, ...args },
        timeoutMs: action === 'navigate' || action === 'open' ? 60_000 : 30_000,
      })
      return typeof result.snapshot === 'string'
        ? result.snapshot
        : JSON.stringify(result, null, 2)
    },
  }
}

export function createBrowserTools(controlUrl, controlToken) {
  const coordinateProperties = {
    ref: { type: 'integer', description: 'Element ref from the latest browser_snapshot.' },
    x: { type: 'number', description: 'Viewport X coordinate when no ref is available.' },
    y: { type: 'number', description: 'Viewport Y coordinate when no ref is available.' },
  }
  return [
    browserTool('browser_open', 'Open a complete HTTP(S) URL in the isolated desktop browser. The browser remains in the background by default.', {
      url: { type: 'string', description: 'Complete http:// or https:// URL.' },
      visible: { type: 'boolean', description: 'Optional visibility override. Omit to use the Browser setting.' },
    }, ['url'], 'open', controlUrl, controlToken),
    browserTool('browser_navigate', 'Navigate the current browser tab to a complete HTTP(S) URL.', {
      url: { type: 'string', description: 'Complete http:// or https:// URL.' },
    }, ['url'], 'navigate', controlUrl, controlToken),
    browserTool('browser_snapshot', 'Read visible page text and numbered interactive elements. Refresh this snapshot after navigation or significant DOM changes.', {}, [], 'snapshot', controlUrl, controlToken),
    browserTool('browser_click', 'Click an element ref from the latest snapshot, or explicit viewport coordinates.', coordinateProperties, [], 'click', controlUrl, controlToken),
    browserTool('browser_type', 'Focus an element and type text. Pass ref or coordinates when focus is not already correct.', {
      ...coordinateProperties,
      text: { type: 'string', description: 'Text to insert.' },
      clear: { type: 'boolean', description: 'Select existing text before inserting.' },
    }, ['text'], 'type', controlUrl, controlToken),
    browserTool('browser_scroll', 'Scroll the current page by a vertical delta.', {
      deltaY: { type: 'number', description: 'Positive scrolls down; negative scrolls up. Defaults to 560.' },
      x: { type: 'number', description: 'Optional viewport X coordinate.' },
      y: { type: 'number', description: 'Optional viewport Y coordinate.' },
    }, [], 'scroll', controlUrl, controlToken),
    browserTool('browser_screenshot', 'Capture the current browser viewport to a local PNG and return its path.', {}, [], 'screenshot', controlUrl, controlToken),
    browserTool('browser_set_viewport', 'Set a virtual page viewport for responsive checks, or reset it by omitting width and height.', {
      width: { type: 'integer', description: 'Viewport width from 240 to 3840.' },
      height: { type: 'integer', description: 'Viewport height from 240 to 2160.' },
    }, [], 'viewport', controlUrl, controlToken),
    browserTool('browser_show', 'Show or hide the built-in browser side panel without closing the page.', {
      visible: { type: 'boolean', description: 'Whether the panel should be visible.' },
    }, ['visible'], 'visibility', controlUrl, controlToken),
    browserTool('browser_back', 'Navigate backward in browser history.', {}, [], 'back', controlUrl, controlToken),
    browserTool('browser_forward', 'Navigate forward in browser history.', {}, [], 'forward', controlUrl, controlToken),
    browserTool('browser_reload', 'Reload the current page.', {}, [], 'reload', controlUrl, controlToken),
    browserTool('browser_close', 'Close the current page and hide the browser panel.', {}, [], 'close', controlUrl, controlToken),
  ]
}

export async function apply(ctx, overrides = {}) {
  const controlUrl = overrides.controlUrl ?? process.env.DSH_DESKTOP_CONTROL_URL
  const controlToken = overrides.controlToken ?? process.env.DSH_DESKTOP_CONTROL_TOKEN
  if (!controlUrl || !controlToken) throw new Error('dsh-desktop-browser requires DeepSeek Harness Desktop')

  let disposers = []
  const clearFeatures = () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
  const applySettings = (settings) => {
    clearFeatures()
    if (settings?.enabled !== true) return
    try {
      for (const tool of createBrowserTools(controlUrl, controlToken)) disposers.push(ctx.tools.register(tool))
      disposers.push(ctx.skills.register({
        name: 'desktop-browser',
        description: '控制 DeepSeek Harness Desktop 的隔离内置浏览器，包括快照、点击、输入、截图和可见性。',
        source: 'runtime',
        content: BROWSER_SKILL,
        invocation: { modelInvocable: true, userInvocable: true },
      }))
    } catch (error) {
      clearFeatures()
      throw error
    }
  }
  const refreshSettings = async () => {
    const payload = await desktopRequest(controlUrl, controlToken, '/v1/browser/settings')
    applySettings(payload.settings)
    return payload
  }

  registerRoutes(ctx, controlUrl, controlToken, refreshSettings)
  await refreshSettings()
  return clearFeatures
}

function registerRoutes(ctx, controlUrl, controlToken, refreshSettings) {
  const routes = [
    [SETTINGS_PATH, '/v1/browser/settings', ['GET', 'PUT']],
    [HISTORY_PATH, '/v1/browser/history', ['GET', 'DELETE']],
    [CLEAR_DATA_PATH, '/v1/browser/clear-data', ['POST']],
  ]
  for (const [path, target, methods] of routes) {
    ctx.webServer.register({
      kind: 'exact',
      path,
      async handler(request, response) {
        if (!methods.includes(request.method)) {
          response.writeHead(405, { allow: methods.join(', ') })
          response.end()
          return
        }
        await proxyDesktopRequest(request, response, controlUrl, controlToken, target)
        if (path === SETTINGS_PATH && request.method === 'PUT') await refreshSettings()
      },
    })
  }
}

async function proxyDesktopRequest(request, response, controlUrl, controlToken, pathname) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readProxyBody(request)
  const result = await fetch(endpoint(controlUrl, pathname), {
    method: request.method,
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await result.text()
  response.writeHead(result.status, {
    'content-type': result.headers.get('content-type') ?? 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(payload)
}

async function readProxyBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (Buffer.byteLength(body, 'utf8') > MAX_PROXY_BODY_BYTES) throw new Error('Desktop browser request is too large')
  }
  return body.length === 0 ? '{}' : body
}
