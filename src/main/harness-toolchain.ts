import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessRuntimeCandidate } from './harness-runtime.js'

const HARNESS_BOOTSTRAP = fileURLToPath(new URL('../harness-bootstrap.cjs', import.meta.url))

export interface HarnessToolchain {
  binPath: string
  dshCommand: string
  pnpmCommand: string
  nodeCommand: string
}

function cmdQuoted(value: string): string {
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`
}

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function runtimeNodeModulesRoot(entryPath: string): string {
  return resolve(dirname(entryPath), '..', '..', '..')
}

async function resolvePnpmEntry(entryPath: string): Promise<string> {
  let current = runtimeNodeModulesRoot(entryPath)
  while (true) {
    const candidate = join(current, 'pnpm', 'bin', 'pnpm.cjs')
    try {
      await access(candidate)
      return candidate
    } catch {
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  throw new Error(`The Harness runtime does not include pnpm: ${entryPath}`)
}

export function prependToolchainToPath(
  environment: NodeJS.ProcessEnv,
  binPath: string,
  pathDelimiter = delimiter,
): NodeJS.ProcessEnv {
  const result = { ...environment }
  const pathKeys = Object.keys(result).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? 'PATH'
  const currentPath = result[pathKey]
  for (const duplicate of pathKeys.slice(1)) delete result[duplicate]
  result[pathKey] = currentPath === undefined || currentPath.length === 0
    ? binPath
    : `${binPath}${pathDelimiter}${currentPath}`
  return result
}

/**
 * Publishes stable private command shims for the currently selected Harness
 * runtime. Harness itself, its Agent terminals, and the desktop UI therefore
 * all resolve the same dsh/pnpm pair instead of depending on a global install.
 */
export class HarnessToolchainManager {
  private readonly binPath: string

  constructor(
    userDataPath: string,
    private readonly electronExecutable: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.binPath = join(userDataPath, 'harness-toolchain', 'bin')
  }

  async prepare(candidate: HarnessRuntimeCandidate): Promise<HarnessToolchain> {
    const pnpmEntry = await resolvePnpmEntry(candidate.entryPath)
    await Promise.all([access(candidate.entryPath), mkdir(this.binPath, { recursive: true })])

    const windows = this.platform === 'win32'
    const suffix = windows ? '.cmd' : ''
    const dshCommand = join(this.binPath, `dsh${suffix}`)
    const pnpmCommand = join(this.binPath, `pnpm${suffix}`)
    const nodeCommand = join(this.binPath, `node${suffix}`)
    if (windows) {
      const nodeMode = '@set "ELECTRON_RUN_AS_NODE=1"\r\n@set "ELECTRON_NO_ATTACH_CONSOLE=1"\r\n'
      await Promise.all([
        writeFile(
          dshCommand,
          `${nodeMode}@${cmdQuoted(this.electronExecutable)} --expose-internals ${cmdQuoted(HARNESS_BOOTSTRAP)} ${cmdQuoted(candidate.entryPath)} %*\r\n`,
          'utf8',
        ),
        writeFile(pnpmCommand, `${nodeMode}@${cmdQuoted(this.electronExecutable)} ${cmdQuoted(pnpmEntry)} %*\r\n`, 'utf8'),
        writeFile(nodeCommand, `${nodeMode}@${cmdQuoted(this.electronExecutable)} %*\r\n`, 'utf8'),
      ])
    } else {
      const nodeMode = '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexport ELECTRON_NO_ATTACH_CONSOLE=1\n'
      await Promise.all([
        writeFile(
          dshCommand,
          `${nodeMode}exec ${shellQuoted(this.electronExecutable)} --expose-internals ${shellQuoted(HARNESS_BOOTSTRAP)} ${shellQuoted(candidate.entryPath)} "$@"\n`,
          'utf8',
        ),
        writeFile(pnpmCommand, `${nodeMode}exec ${shellQuoted(this.electronExecutable)} ${shellQuoted(pnpmEntry)} "$@"\n`, 'utf8'),
        writeFile(nodeCommand, `${nodeMode}exec ${shellQuoted(this.electronExecutable)} "$@"\n`, 'utf8'),
      ])
      await Promise.all([
        chmod(dshCommand, 0o755),
        chmod(pnpmCommand, 0o755),
        chmod(nodeCommand, 0o755),
      ])
    }

    return { binPath: this.binPath, dshCommand, pnpmCommand, nodeCommand }
  }
}
