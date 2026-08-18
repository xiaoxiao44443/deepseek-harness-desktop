import { describe, expect, it } from 'vitest'
import { normalizeBrowserAddress, normalizeBrowserSettings } from './src/main/desktop-browser.js'
import { BROWSER_SKILL, createBrowserTools } from './resources/dsh-desktop-browser/lib/index.js'

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

describe('desktop browser plugin', () => {
  it('publishes the browser workflow without keyboard shortcuts', () => {
    const tools = createBrowserTools('http://127.0.0.1:12345/v1/restart-harness', 'secret')
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_screenshot',
      'browser_set_viewport',
      'browser_show',
    ]))
    expect(BROWSER_SKILL).toContain('background')
    expect(BROWSER_SKILL).toContain('latest snapshot')
    expect(BROWSER_SKILL).not.toMatch(/Ctrl|Alt|shortcut/iu)
  })
})
