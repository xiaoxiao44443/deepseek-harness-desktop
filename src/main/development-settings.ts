import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DevelopmentSettings {
  patchPath?: string
}

export async function readDevelopmentSettings(path: string): Promise<DevelopmentSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { patchPath?: unknown }
    return typeof parsed.patchPath === 'string' && parsed.patchPath.trim() !== ''
      ? { patchPath: parsed.patchPath }
      : {}
  } catch {
    return {}
  }
}

export async function writeDevelopmentSettings(path: string, settings: DevelopmentSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  const normalized = settings.patchPath === undefined ? {} : { patchPath: settings.patchPath }
  await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
