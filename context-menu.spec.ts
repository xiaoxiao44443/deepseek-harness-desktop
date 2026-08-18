import { describe, expect, it } from 'vitest'
import {
  clampContextMenuPosition,
  parsePluginContextMenuCollection,
  sanitizeContextMenuEntries,
} from './src/shared/context-menu.js'
import { appendPluginContextMenuItems, buildBuiltinContextMenuItems } from './src/main/context-menu.js'

describe('desktop context menu protocol', () => {
  it('sanitizes entries and collapses invalid separators', () => {
    expect(sanitizeContextMenuEntries([
      { kind: 'separator', id: 'leading' },
      { kind: 'item', id: 'desktop.copy', label: '复制', icon: 'copy', shortcut: 'Ctrl+C' },
      { kind: 'separator', id: 'group-1' },
      { kind: 'separator', id: 'group-2' },
      { kind: 'item', id: 'plugin.archive', label: '归档', icon: 'not-allowed', danger: false },
      { kind: 'separator', id: 'trailing' },
    ])).toEqual([
      { kind: 'item', id: 'desktop.copy', label: '复制', enabled: true, icon: 'copy' },
      { kind: 'separator', id: 'group-1' },
      { kind: 'item', id: 'plugin.archive', label: '归档', enabled: true, danger: false },
    ])
  })

  it('only accepts namespaced plugin contributions', () => {
    expect(parsePluginContextMenuCollection({
      token: 'menu-1',
      items: [
        { kind: 'item', id: 'desktop.copy', label: '伪造复制' },
        { kind: 'item', id: 'plugin.archive', label: '归档', icon: 'archive' },
      ],
    })).toEqual({
      token: 'menu-1',
      items: [{ kind: 'item', id: 'plugin.archive', label: '归档', enabled: true, icon: 'archive' }],
    })
  })

  it('keeps the menu inside the viewport', () => {
    expect(clampContextMenuPosition(790, 590, 220, 180, 800, 600)).toEqual({ x: 572, y: 412 })
    expect(clampContextMenuPosition(-20, -40, 220, 180, 800, 600)).toEqual({ x: 8, y: 8 })
  })

  it('builds a usable core menu without any Harness plugin', () => {
    const items = buildBuiltinContextMenuItems({
      isEditable: true,
      selectionText: 'hello',
      linkURL: '',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canDelete: true,
        canSelectAll: true,
        canEditRichly: false,
      },
    })

    expect(items.filter((entry) => entry.kind === 'item').map((entry) => [entry.id, entry.enabled])).toEqual([
      ['desktop.undo', true],
      ['desktop.redo', false],
      ['desktop.cut', true],
      ['desktop.copy', true],
      ['desktop.paste', true],
      ['desktop.select-all', true],
    ])
    expect(items.find((entry) => entry.kind === 'item' && entry.id === 'desktop.copy')).not.toHaveProperty('shortcut')
  })

  it('only offers copy outside editable controls when text is selected', () => {
    const snapshot = {
      isEditable: false,
      linkURL: '',
      editFlags: {
        canUndo: false,
        canRedo: false,
        canCut: false,
        canCopy: false,
        canPaste: false,
        canDelete: false,
        canSelectAll: true,
        canEditRichly: false,
      },
    }
    const withoutSelection = buildBuiltinContextMenuItems({ ...snapshot, selectionText: '' })
    const withSelection = buildBuiltinContextMenuItems({ ...snapshot, selectionText: 'hello' })

    expect(withoutSelection.some((entry) => entry.kind === 'item' && entry.id === 'desktop.copy')).toBe(false)
    expect(withSelection.some((entry) => entry.kind === 'item' && entry.id === 'desktop.copy')).toBe(true)
  })

  it('separates embedded and default browser link actions', () => {
    const items = buildBuiltinContextMenuItems({
      isEditable: false,
      selectionText: '',
      linkURL: 'https://example.com/',
      editFlags: {
        canUndo: false,
        canRedo: false,
        canCut: false,
        canCopy: false,
        canPaste: false,
        canDelete: false,
        canSelectAll: true,
        canEditRichly: false,
      },
    }, { embeddedBrowserEnabled: true })

    expect(items.filter((entry) => entry.kind === 'item').slice(0, 3)).toEqual([
      { kind: 'item', id: 'desktop.open-link-in-browser', label: '在内置浏览器中打开', enabled: true, icon: 'browser' },
      { kind: 'item', id: 'desktop.open-link', label: '在默认浏览器中打开', enabled: true, icon: 'external-link' },
      { kind: 'item', id: 'desktop.copy-link', label: '复制链接地址', enabled: true, icon: 'link' },
    ])
  })

  it('offers one copy action for image contents', () => {
    const items = buildBuiltinContextMenuItems({
      isEditable: false,
      selectionText: '',
      linkURL: '',
      mediaType: 'image',
      hasImageContents: true,
      srcURL: 'blob:http://127.0.0.1/image-preview',
      editFlags: {
        canUndo: false,
        canRedo: false,
        canCut: false,
        canCopy: false,
        canPaste: false,
        canDelete: false,
        canSelectAll: true,
        canEditRichly: false,
      },
    })

    expect(items.filter((entry) => entry.kind === 'item')).toEqual([
      { kind: 'item', id: 'desktop.copy-image', label: '复制', enabled: true, icon: 'copy' },
    ])
  })

  it('offers image copy when Chromium provides a source before decoded contents', () => {
    const items = buildBuiltinContextMenuItems({
      isEditable: false,
      selectionText: '',
      linkURL: '',
      mediaType: 'image',
      hasImageContents: false,
      srcURL: 'blob:http://127.0.0.1/composer-preview',
      editFlags: {
        canUndo: false,
        canRedo: false,
        canCut: false,
        canCopy: false,
        canPaste: false,
        canDelete: false,
        canSelectAll: true,
        canEditRichly: false,
      },
    })

    expect(items.filter((entry) => entry.kind === 'item')).toEqual([
      { kind: 'item', id: 'desktop.copy-image', label: '复制', enabled: true, icon: 'copy' },
    ])
  })

  it('places plugin contributions behind a stable separator', () => {
    expect(appendPluginContextMenuItems(
      [{ kind: 'item', id: 'desktop.copy', label: '复制', enabled: true }],
      [{ kind: 'item', id: 'plugin.archive', label: '归档', enabled: true }],
    )).toEqual([
      { kind: 'item', id: 'desktop.copy', label: '复制', enabled: true },
      { kind: 'separator', id: 'desktop.separator.plugins' },
      { kind: 'item', id: 'plugin.archive', label: '归档', enabled: true },
    ])
  })
})
