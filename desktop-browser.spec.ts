import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeBrowserAddress, normalizeBrowserSettings } from './src/main/desktop-browser.js'
import { evaluatePage, parseLocatorPlan } from './src/main/desktop-browser-automation.js'
import type { BrowserTabRuntime } from './src/main/desktop-browser-types.js'
import { BROWSER_CONTROL_DOCUMENTATION, BROWSER_SKILL, createBrowserTools } from './resources/dsh-desktop-browser/lib/index.js'

afterEach(() => vi.unstubAllGlobals())

describe('desktop browser settings', () => {
  it('defaults to an enabled background browser and normalizes stored values', () => {
    expect(normalizeBrowserSettings(undefined)).toEqual({ enabled: true, agentOpenMode: 'background', displayMode: 'split' })
    expect(normalizeBrowserSettings({ enabled: false, agentOpenMode: 'visible', displayMode: 'floating' })).toEqual({
      enabled: false,
      agentOpenMode: 'visible',
      displayMode: 'floating',
    })
    expect(normalizeBrowserSettings({ enabled: 'yes', agentOpenMode: 'other', displayMode: 'other' })).toEqual({
      enabled: true,
      agentOpenMode: 'background',
      displayMode: 'split',
    })
  })

  it('accepts web addresses, preserves local HTTP, and searches shell input', () => {
    expect(normalizeBrowserAddress('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeBrowserAddress('localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeBrowserAddress('browser automation')).toBe(
      'https://www.bing.com/search?q=browser%20automation',
    )
    expect(() => normalizeBrowserAddress('browser automation', false)).toThrow('完整')
    expect(() => normalizeBrowserAddress('file:///tmp/example.html', false)).toThrow('完整')
  })
})

describe('desktop browser automation helpers', () => {
  it('parses locator plans outside the Electron window controller', () => {
    expect(parseLocatorPlan({ locator: [
      { kind: 'role', value: 'button', name: '保存', exact: true },
      { kind: 'nth', value: '0' },
    ] })).toEqual([
      { kind: 'role', value: 'button', name: '保存', exact: true },
      { kind: 'nth', value: '0' },
    ])
    expect(() => parseLocatorPlan({ locator: [{ kind: 'nth', value: 'first' }] })).toThrow('nth')
  })

  it('keeps page evaluation read-only after moving it out of the controller', async () => {
    const tab = { id: 'agent-test' } as BrowserTabRuntime
    const command = vi.fn(async () => ({ result: { value: { title: 'Example' } } }))
    await expect(evaluatePage(tab, { script: '() => ({ title: document.title })' }, command)).resolves.toEqual({
      ok: true,
      tabId: 'agent-test',
      value: { title: 'Example' },
    })
    await expect(evaluatePage(tab, { script: '() => fetch("https://example.com")' }, command)).rejects.toThrow('只读')
    expect(command).toHaveBeenCalledTimes(1)
  })
})

describe('desktop browser plugin', () => {
  it('publishes one JavaScript browser tool and its runtime API', () => {
    const tools = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')
    expect(tools.map((tool) => tool.name)).toEqual(['browser_execute'])
    expect(tools[0]?.parameters.required).toEqual(['code'])
    expect(tools[0]?.parameters.properties.code).toEqual(expect.objectContaining({
      type: 'string',
      maxLength: 16000,
    }))
    expect(BROWSER_SKILL).toContain('background')
    expect(BROWSER_SKILL).toContain('browser_execute')
    expect(BROWSER_SKILL).toContain('return await browser.documentation()')
    expect(BROWSER_SKILL).toContain('exactly once')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('browser.tabs.new')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('browser.tabs.finalize')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('tab.playwright.domSnapshot')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('getByRole')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('focus()')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('expectNavigation')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('waitForURL')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('tab.cua')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('stable element refs')
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('One script may perform several related browser actions')
    expect(BROWSER_SKILL).not.toMatch(/Ctrl|Alt|shortcut/iu)
    expect(BROWSER_CONTROL_DOCUMENTATION).toContain('claims the unused blank new tab')
  })

  it('returns the complete selected-browser guide without contacting the page host', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: 'return await browser.documentation();',
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output)).toEqual({
      result: BROWSER_CONTROL_DOCUMENTATION,
      actions: [],
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('exposes the Codex-shaped coordinate fallback without adding model tools', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      return new Response(JSON.stringify(body.action === 'new' ? { ok: true, tabId: 'agent-cua' } : { ok: true, tabId: body.tabId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    await tool.execute({
      code: `const tab = await browser.tabs.new();
await tab.cua.move({ x: 10, y: 20 });
await tab.cua.click({ x: 10, y: 20 });
await tab.cua.double_click({ x: 12, y: 22 });
await tab.cua.drag({ path: [{ x: 1, y: 2 }, { x: 8, y: 9 }] });
await tab.cua.keypress({ keys: ['Control', 'A'] });
await tab.cua.type({ text: 'hello' });
await tab.cua.scroll({ x: 100, y: 120, scrollX: 0, scrollY: 500 });`,
    }, { agent: { id: 'session-a' } })
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies.slice(1).map((body) => body.action)).toEqual(['hover', 'click', 'click', 'drag', 'press', 'type', 'scroll'])
    expect(bodies[3]).toEqual(expect.objectContaining({ clickCount: 2, x: 12, y: 22 }))
    expect(bodies[4]).toEqual(expect.objectContaining({ startX: 1, startY: 2, endX: 8, endY: 9 }))
    expect(bodies[5]).toEqual(expect.objectContaining({ key: 'Control+A' }))
    expect(bodies[7]).toEqual(expect.objectContaining({ deltaX: 0, deltaY: 500 }))
  })

  it('binds DOM CUA node ids to the latest snapshot version', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      return new Response(JSON.stringify(body.action === 'new'
        ? { ok: true, tabId: 'agent-dom-cua' }
        : body.action === 'snapshot'
          ? { ok: true, tabId: body.tabId, snapshotVersion: 9, snapshot: '[14] button “Save”' }
          : { ok: true, tabId: body.tabId }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const dom = await tab.dom_cua.get_visible_dom();
await tab.dom_cua.click({ node_id: '[14]' });
return dom;`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toBe('[14] button “Save”')
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'click', tabId: 'agent-dom-cua', ref: 14, snapshotVersion: 9,
    }))
  })

  it('exposes bounded page inspection and console logs', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      if (body.action === 'new') return new Response(JSON.stringify({ ok: true, tabId: 'agent-dev' }))
      if (body.action === 'evaluate') return new Response(JSON.stringify({ ok: true, value: { title: 'Example' } }))
      return new Response(JSON.stringify({ ok: true, logs: [{ level: 'error', message: 'boom', timestamp: 'now' }] }))
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const page = await tab.playwright.evaluate((arg) => ({ title: document.title, arg }), { key: 1 });
const logs = await tab.dev.logs({ levels: ['error'], limit: 10 });
return { page, logs };`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toEqual({
      page: { title: 'Example' },
      logs: [{ level: 'error', message: 'boom', timestamp: 'now' }],
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'evaluate', tabId: 'agent-dev', argument: { key: 1 },
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'logs', tabId: 'agent-dev', levels: ['error'], limit: 10,
    }))
  })

  it('models file chooser, download, and JavaScript dialog lifecycles', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      const payload = body.action === 'new' ? { ok: true, tabId: 'agent-events' }
        : body.action === 'wait-event' && body.event === 'filechooser' ? { ok: true, eventId: 'chooser-1', multiple: false }
          : body.action === 'wait-event' ? { ok: true, eventId: 'download-1' }
            : body.action === 'download-path' ? { ok: true, path: '/tmp/result.txt' }
              : body.action === 'get-dialog' ? { ok: true, dialog: { type: 'prompt' } }
                : { ok: true, count: 1 }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const chooserPromise = tab.playwright.waitForEvent('filechooser');
await tab.playwright.getByText('Upload').click();
const chooser = await chooserPromise;
await chooser.setFiles('/tmp/upload.txt');
const download = await tab.playwright.waitForEvent('download');
const path = await download.path();
const dialog = await tab.getJsDialog();
await dialog.accept('answer');
return { path, multiple: chooser.isMultiple(), type: dialog.type };`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toEqual({ path: '/tmp/result.txt', multiple: false, type: 'prompt' })
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies.map((body) => body.action)).toEqual([
      'new', 'wait-event', 'locator', 'filechooser-set-files', 'wait-event', 'download-path', 'get-dialog', 'handle-dialog',
    ])
    expect(bodies[3]).toEqual(expect.objectContaining({ eventId: 'chooser-1', paths: ['/tmp/upload.txt'] }))
    expect(bodies[7]).toEqual(expect.objectContaining({ accept: true, promptText: 'answer' }))
  })

  it('serializes navigation synchronization and page wait helpers', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      if (body.action === 'new') return new Response(JSON.stringify({ ok: true, tabId: 'agent-nav' }))
      if (body.action === 'navigation-state') return new Response(JSON.stringify({ ok: true, tabId: body.tabId, version: 7 }))
      return new Response(JSON.stringify({ ok: true, tabId: body.tabId, operation: body.operation }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const link = tab.playwright.getByRole('link', { name: 'Continue' });
await tab.playwright.expectNavigation(() => link.click(), { url: 'https://example.com/*', waitUntil: 'domcontentloaded' });
await tab.playwright.waitForURL('https://example.com/next', { waitUntil: 'load' });
await tab.playwright.waitForTimeout(5);
return tab.id;`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toBe('agent-nav')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'navigation-state', tabId: 'agent-nav', sessionId: 'session-a',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'locator', operation: 'click', tabId: 'agent-nav',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[3]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'wait-navigation', afterVersion: 7, url: 'https://example.com/*', waitUntil: 'domcontentloaded',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[4]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'wait-url', url: 'https://example.com/next', waitUntil: 'load',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[5]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'wait-timeout', timeoutMs: 5,
    }))
  })

  it('runs several browser API calls while binding every action to the DSH session', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      const payload = body.action === 'new'
        ? { ok: true, tabId: 'agent-1', url: '' }
        : body.action === 'navigate'
          ? { ok: true, tabId: body.tabId, url: body.url }
          : { ok: true, tabId: body.tabId, snapshotVersion: 4, snapshot: 'Page snapshot' }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    if (tool === undefined) throw new Error('browser_execute missing')

    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
await tab.goto('https://example.com/');
return await tab.playwright.domSnapshot();`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output)).toEqual({
      result: 'Page snapshot',
      actions: [
        expect.objectContaining({ action: 'new', tabId: 'agent-1' }),
        expect.objectContaining({ action: 'navigate', tabId: 'agent-1' }),
        expect.objectContaining({ action: 'snapshot', tabId: 'agent-1', snapshotVersion: 4 }),
      ],
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(new URL('http://127.0.0.1:12345/v1/browser/action'))
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      action: 'new', sessionId: 'session-a',
    })
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual(new URL('http://127.0.0.1:12345/v1/browser/action'))
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      tabId: 'agent-1', url: 'https://example.com/', action: 'navigate', sessionId: 'session-a',
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual({
      tabId: 'agent-1', action: 'snapshot', sessionId: 'session-a',
    })
    await expect(tool.execute({ code: 'return await browser.tabs.list()' }, {})).rejects.toThrow('calling DSH agent session')
  })

  it('serializes semantic Playwright locators and keeps their tab binding private', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      if (body.action === 'new') return new Response(JSON.stringify({ ok: true, tabId: 'agent-2' }))
      if (body.operation === 'count') return new Response(JSON.stringify({ ok: true, tabId: body.tabId, operation: 'count', count: 1 }))
      return new Response(JSON.stringify({ ok: true, tabId: body.tabId, operation: body.operation }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const form = tab.playwright.locator('form[data-testid="login"]');
const buttons = form.getByRole('button');
const count = await buttons.count();
const all = await buttons.all();
const labels = await buttons.allTextContents();
const button = buttons.nth(0);
await button.click();
await button.dblclick();
await button.focus();
await button.setChecked(true);
return { count, allCount: all.length, labels, tabId: tab.id };`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toEqual({ count: 1, allCount: 1, tabId: 'agent-2' })
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      tabId: 'agent-2',
      locator: [
        { kind: 'css', value: 'form[data-testid="login"]' },
        { kind: 'role', value: 'button', exact: false },
      ],
      operation: 'count',
      action: 'locator',
      sessionId: 'session-a',
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[4]?.[1]?.body))).toEqual(expect.objectContaining({
      tabId: 'agent-2',
      locator: [
        { kind: 'css', value: 'form[data-testid="login"]' },
        { kind: 'role', value: 'button', exact: false },
        { kind: 'nth', value: '0' },
      ],
      operation: 'click',
      action: 'locator',
      sessionId: 'session-a',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[6]?.[1]?.body))).toEqual(expect.objectContaining({
      tabId: 'agent-2',
      operation: 'focus',
      action: 'locator',
      sessionId: 'session-a',
    }))
    expect(JSON.parse(String(fetchImpl.mock.calls[7]?.[1]?.body))).toEqual(expect.objectContaining({
      tabId: 'agent-2',
      operation: 'set-checked',
      checked: true,
      action: 'locator',
      sessionId: 'session-a',
    }))
  })

  it('serializes nested frame locators as frame-scoped locator plans', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      return new Response(JSON.stringify(body.action === 'new'
        ? { ok: true, tabId: 'agent-frame' }
        : { ok: true, tabId: body.tabId, operation: body.operation, count: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
const button = tab.playwright.frameLocator('iframe[name="outer"]').frameLocator('iframe.inner').getByRole('button', { name: 'Pay' });
return await button.count();`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toBe(1)
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      locator: [
        { kind: 'frame', value: 'iframe[name="outer"]' },
        { kind: 'frame', value: 'iframe.inner' },
        { kind: 'role', value: 'button', name: 'Pay', exact: false },
      ],
      operation: 'count',
    }))
  })

  it('serializes locator filters and same-tab combinations', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      return new Response(JSON.stringify(body.action === 'new' ? { ok: true, tabId: 'agent-filter' } : { ok: true, count: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    await tool.execute({
      code: `const tab = await browser.tabs.new();
const buttons = tab.playwright.getByRole('button');
const save = buttons.filter({ hasText: 'Save', hasNotText: 'draft' });
const exact = save.and(tab.playwright.getByTestId('save'));
const either = exact.or(tab.playwright.getByText('Save now'));
return await either.count();`,
    }, { agent: { id: 'session-a' } })
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))
    expect(body.locator.map((step: { kind: string }) => step.kind)).toEqual(['role', 'filter', 'and', 'or'])
    expect(JSON.parse(body.locator[1].value)).toEqual({ hasText: 'Save', hasNotText: 'draft' })
    expect(JSON.parse(body.locator[2].value)).toEqual([{ kind: 'testid', value: 'save' }])
  })

  it('serializes read-only locator evaluation', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      return new Response(JSON.stringify(body.action === 'new' ? { ok: true, tabId: 'agent-locator-eval' } : { ok: true, value: 'Save' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.new();
return await tab.playwright.getByRole('button', { name: 'Save' }).evaluate((element, suffix) => element.textContent + suffix, '');`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toBe('Save')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      action: 'locator', operation: 'evaluate', argument: '', tabId: 'agent-locator-eval',
    }))
  })

  it('does not expose Node globals to browser scripts', async () => {
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({ code: 'return { process: typeof process, require: typeof require, browser: typeof browser }' }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toEqual({ process: 'undefined', require: 'undefined', browser: 'object' })
    await expect(tool.execute({
      code: 'return browser.tabs.new.constructor("return process")()',
    }, { agent: { id: 'session-a' } })).rejects.toThrow('Code generation from strings disallowed')
  })

  it('lists, selects, and binds tab operations through Codex-style Tab objects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      activeTabId: 'agent-1',
      panelOpen: false,
      tabs: [{ id: 'agent-1', url: 'https://example.com/' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tabs = await browser.tabs.list();
const selected = await browser.tabs.selected();
return { firstTab: tabs[0], selectedId: selected?.id, url: await selected?.url() };`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toEqual({
      firstTab: { id: 'agent-1', url: 'https://example.com/' },
      selectedId: 'agent-1',
      url: 'https://example.com/',
    })
  })

  it('finalizes tabs with Tab objects and reports completed action traces on failure', async () => {
    const fetchImpl = vi.fn(async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      if (body.action === 'tabs') {
        return new Response(JSON.stringify({
          ok: true,
          activeTabId: 'agent-1',
          tabs: [{ id: 'agent-1', title: 'Example', url: 'https://example.com/' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true, closed: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const tool = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')[0]
    const output = await tool.execute({
      code: `const tab = await browser.tabs.get('agent-1');
await browser.tabs.finalize({ keep: [{ tab, status: 'handoff' }] });
return tab.id;`,
    }, { agent: { id: 'session-a' } })
    expect(JSON.parse(output).result).toBe('agent-1')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      keep: [{ tabId: 'agent-1', status: 'handoff' }],
      action: 'finalize',
      sessionId: 'session-a',
    })

    await expect(tool.execute({
      code: `await browser.tabs.list();
throw new Error('after tabs');`,
    }, { agent: { id: 'session-a' } })).rejects.toThrow('Completed browser actions')
  })
})
