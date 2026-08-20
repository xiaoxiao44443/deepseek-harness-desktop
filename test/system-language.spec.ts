import { describe, expect, it } from 'vitest'
import { workspaceDirectoryDialogTitle } from '../src/main/system-language.js'

describe('system language strings', () => {
  it.each([
    ['zh-CN', '选择工作区文件夹'],
    ['zh-Hans-CN', '选择工作区文件夹'],
    ['zh_TW', '選擇工作區資料夾'],
    ['zh-Hant-HK', '選擇工作區資料夾'],
    ['en-US', 'Select Workspace Directory'],
    ['ja-JP', 'Select Workspace Directory'],
  ])('localizes the workspace directory title for %s', (locale, expected) => {
    expect(workspaceDirectoryDialogTitle(locale)).toBe(expected)
  })
})
