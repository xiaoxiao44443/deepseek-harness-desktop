import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface HarnessRuntimeState {
  schemaVersion: 1
  activeVersion?: string
  pendingVersion?: string
  lastCheckAt?: string
  badVersions: Record<string, { failedAt: string; reason: string }>
}

export const EMPTY_RUNTIME_STATE: HarnessRuntimeState = { schemaVersion: 1, badVersions: {} }

export async function readRuntimeState(path: string): Promise<HarnessRuntimeState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<HarnessRuntimeState>
    if (parsed.schemaVersion !== 1) return structuredClone(EMPTY_RUNTIME_STATE)
    return {
      schemaVersion: 1,
      ...(typeof parsed.activeVersion === 'string' ? { activeVersion: parsed.activeVersion } : {}),
      ...(typeof parsed.pendingVersion === 'string' ? { pendingVersion: parsed.pendingVersion } : {}),
      ...(typeof parsed.lastCheckAt === 'string' ? { lastCheckAt: parsed.lastCheckAt } : {}),
      badVersions: typeof parsed.badVersions === 'object' && parsed.badVersions !== null ? parsed.badVersions : {},
    }
  } catch {
    return structuredClone(EMPTY_RUNTIME_STATE)
  }
}

export async function writeRuntimeState(path: string, state: HarnessRuntimeState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  try {
    await rename(temporaryPath, path)
  } catch {
    await rm(path, { force: true })
    await rename(temporaryPath, path)
  }
}
