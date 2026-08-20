import { describe, expect, it } from 'vitest'
import { buildHarnessArguments, withHarnessStartupOutput } from '../src/main/harness-process.js'

describe('Harness launch arguments', () => {
  it('keeps every DSH launcher patch before web application options', () => {
    expect(buildHarnessArguments('desktop.patch.yml', 'recovery.patch.yml', {
      patchPath: 'development.patch.yml',
    })).toEqual([
      'web',
      '--patch', 'desktop.patch.yml',
      '--patch', 'development.patch.yml',
      '--patch', 'recovery.patch.yml',
      '--no-open',
      '--port', '0',
    ])
  })
})

describe('Harness startup diagnostics', () => {
  it('keeps the captured process error with the generic exit message', () => {
    const error = withHarnessStartupOutput(
      new Error('Harness exited before startup (1)'),
      '\u001b[31mError: EPERM: operation not permitted, stat runtime-link\u001b[0m\n',
    )

    expect(error.message).toContain('Harness exited before startup (1)')
    expect(error.message).toContain('Error: EPERM: operation not permitted, stat runtime-link')
    expect(error.message).not.toContain('\u001b[31m')
  })
})
