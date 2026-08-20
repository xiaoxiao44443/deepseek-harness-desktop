import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Harness bootstrap console compatibility', () => {
  it('keeps Electron Node workers attached to the hidden Harness console', async () => {
    const source = await readFile(new URL('./src/harness-bootstrap.cts', import.meta.url), 'utf8')

    expect(source).toContain('freeConsole()')
    expect(source.indexOf('freeConsole()')).toBeLessThan(source.indexOf('allocConsole()'))
    expect(source).toContain('delete childEnvironment.ELECTRON_NO_ATTACH_CONSOLE')
    expect(source).not.toContain("ELECTRON_NO_ATTACH_CONSOLE: '1',")
    expect(source).toContain("workerArgs = [windowsAclRunnerWorkerShim, args[0], ...args.slice(1)]")
  })
})
