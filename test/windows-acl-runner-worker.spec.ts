import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Windows ACL runner worker', () => {
  it('attaches Electron-as-Node runners to the Harness console before importing the runner', async () => {
    const source = await readFile(new URL('../src/windows-acl-runner-worker.cts', import.meta.url), 'utf8')
    const attachIndex = source.indexOf('attachToHarnessConsole(runnerEntry)')
    const importIndex = source.indexOf('await import(pathToFileURL(runnerEntry).href)')

    expect(source).toContain('AttachConsole(uint32 processId)')
    expect(source).toContain('ATTACH_PARENT_PROCESS')
    expect(attachIndex).toBeGreaterThan(-1)
    expect(importIndex).toBeGreaterThan(attachIndex)
  })
})
