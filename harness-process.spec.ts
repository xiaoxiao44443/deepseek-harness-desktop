import { describe, expect, it } from 'vitest'
import { buildHarnessArguments } from './src/main/harness-process.js'

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
