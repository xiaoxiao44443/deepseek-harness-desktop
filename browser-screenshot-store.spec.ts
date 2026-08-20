import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import {
  BrowserScreenshotStore,
  clipCssScreenshotRect,
  cssRectToImageCrop,
  pathIsInside,
  selectScreenshotCacheRemovals,
} from './src/main/browser-screenshot-store.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })))
})

describe('browser screenshot geometry', () => {
  it('clips CSS viewport rectangles and maps them to DPR-scaled PNG pixels', () => {
    expect(clipCssScreenshotRect({ x: -10, y: 20, width: 60, height: 40 }, { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 20,
      width: 50,
      height: 40,
    })
    expect(cssRectToImageCrop(
      { x: 10.25, y: 20.25, width: 100.5, height: 50.5 },
      { width: 800, height: 600 },
      { width: 1_600, height: 1_200 },
    )).toEqual({
      rect: { x: 10.25, y: 20.25, width: 100.5, height: 50.5 },
      crop: { x: 20, y: 40, width: 202, height: 102 },
      scaleX: 2,
      scaleY: 2,
    })
    expect(() => clipCssScreenshotRect({ x: 801, y: 0, width: 10, height: 10 }, { width: 800, height: 600 }))
      .toThrow('当前视口之外')
  })

  it('contains paths correctly on macOS and Windows without prefix or traversal confusion', () => {
    expect(pathIsInside('/Users/xiao/cache', '/Users/xiao/cache/browser-a.png', 'posix')).toBe(true)
    expect(pathIsInside('/Users/xiao/cache', '/Users/xiao/cache-other/browser-a.png', 'posix')).toBe(false)
    expect(pathIsInside('/Users/xiao/cache', '/Users/xiao/cache/../private.txt', 'posix')).toBe(false)
    expect(pathIsInside('C:\\Users\\xiao\\cache', 'C:\\Users\\xiao\\cache\\browser-a.png', 'win32')).toBe(true)
    expect(pathIsInside('C:\\Users\\xiao\\cache', 'C:\\Users\\xiao\\cache-old\\browser-a.png', 'win32')).toBe(false)
    expect(pathIsInside('C:\\Users\\xiao\\cache', 'D:\\browser-a.png', 'win32')).toBe(false)
  })

  it('selects expired files first and then oldest files until under the capacity limit', () => {
    expect(selectScreenshotCacheRemovals([
      { name: 'expired.png', bytes: 10, modifiedAt: 0 },
      { name: 'old.png', bytes: 60, modifiedAt: 900 },
      { name: 'new.png', bytes: 60, modifiedAt: 950 },
    ], 1_000, 500, 100)).toEqual(['expired.png', 'old.png'])
  })
})

describe('BrowserScreenshotStore', () => {
  it.runIf(process.platform !== 'win32')('rejects a symlink as the cache root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dfy-browser-screenshot-link-'))
    temporaryPaths.push(root)
    const target = join(root, 'target')
    const link = join(root, 'screenshots')
    await mkdir(target)
    await symlink(target, link, 'dir')
    await expect(new BrowserScreenshotStore(link).initialize()).rejects.toThrow('不安全')
  })

  it('writes once, keeps the same PNG Buffer in memory, and clears only its own temporary cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dfy-browser-screenshot-'))
    temporaryPaths.push(root)
    const screenshotRoot = join(root, 'browser', 'screenshots')
    const attachmentsRoot = join(root, 'attachments')
    await mkdir(attachmentsRoot, { recursive: true })
    const durableAttachment = join(attachmentsRoot, 'conversation.png')
    await writeFile(durableAttachment, 'durable')
    const store = new BrowserScreenshotStore(screenshotRoot)
    await store.initialize()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const saved = await store.save(png, {
      width: 2,
      height: 2,
      sourceUrl: 'https://example.com/',
      capturedAt: '2026-08-20T00:00:00.000Z',
      kind: 'viewport',
      scrollX: 0,
      scrollY: 120,
    })

    expect(saved.path.startsWith(`${screenshotRoot}/`)).toBe(true)
    expect(saved.path.endsWith('.png')).toBe(true)
    expect(store.get(saved.resourceId)?.data).toBe(png)
    expect(await readFile(saved.path)).toEqual(png)
    expect(await store.stats()).toEqual({ path: screenshotRoot, files: 1, bytes: png.byteLength })

    expect(await store.clear()).toEqual({ path: screenshotRoot, files: 0, bytes: 0 })
    expect(store.get(saved.resourceId)).toBeUndefined()
    await expect(stat(saved.path)).rejects.toThrow()
    await expect(readFile(durableAttachment, 'utf8')).resolves.toBe('durable')
  })
})
