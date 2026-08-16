import { describe, expect, it } from 'vitest'
import { parseCommandArguments } from './src/main/command-arguments.js'

describe('parseCommandArguments', () => {
  it('keeps quoted local plugin paths as one pnpm argument', () => {
    expect(parseCommandArguments('add "E:\\项目文件\\scratch plugin" --save-dev'))
      .toEqual(['add', 'E:\\项目文件\\scratch plugin', '--save-dev'])
  })

  it('supports empty and single-quoted values without invoking a shell', () => {
    expect(parseCommandArguments("exec tool --name '' --label 'create mode'"))
      .toEqual(['exec', 'tool', '--name', '', '--label', 'create mode'])
  })

  it('rejects an unfinished quote', () => {
    expect(() => parseCommandArguments('add "unfinished')).toThrow('未闭合')
  })
})
