import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_RUNTIME_STATE, readRuntimeState, writeRuntimeState } from '../src/main/runtime-state.js'

describe('runtime state', () => {
  it('returns a clean state when the file is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    await expect(readRuntimeState(join(root, 'missing.json'))).resolves.toEqual(EMPTY_RUNTIME_STATE)
  })

  it('writes atomically and preserves update fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    const path = join(root, 'nested', 'state.json')
    const state = {
      schemaVersion: 1 as const,
      activeVersion: '0.1.0-rc.6',
      pendingVersion: '0.1.0-rc.7',
      lastCheckAt: '2026-08-16T00:00:00.000Z',
      badVersions: {},
    }
    await writeRuntimeState(path, state)
    await expect(readRuntimeState(path)).resolves.toEqual(state)
    expect(await readFile(path, 'utf8')).toContain('0.1.0-rc.7')
  })

  it('recovers from malformed state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-state-'))
    const path = join(root, 'state.json')
    await writeFile(path, '{broken', 'utf8')
    await expect(readRuntimeState(path)).resolves.toEqual(EMPTY_RUNTIME_STATE)
  })
})
