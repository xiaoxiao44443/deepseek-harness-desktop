const TRADITIONAL_CHINESE_REGIONS = new Set(['hk', 'mo', 'tw'])

export function workspaceDirectoryDialogTitle(locale: string): string {
  const parts = locale.replaceAll('_', '-').toLowerCase().split('-')
  if (parts[0] !== 'zh') return 'Select Workspace Directory'

  const usesTraditionalChinese = parts.includes('hant')
    || parts.some((part) => TRADITIONAL_CHINESE_REGIONS.has(part))

  return usesTraditionalChinese
    ? '選擇工作區資料夾'
    : '选择工作区文件夹'
}
