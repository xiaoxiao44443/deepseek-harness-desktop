import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import semver from 'semver'
import { x as extractTar } from 'tar'
import type { HarnessUpdateStatus } from '../shared/contracts.js'
import { readRuntimeState, writeRuntimeState, type HarnessRuntimeState } from './runtime-state.js'
import { applyHarnessRuntimeCompatibility } from './runtime-compat.js'

const require = createRequire(import.meta.url)
const HARNESS_PACKAGE = '@deepseek-ai/dsh'
export const DESKTOP_PNPM_VERSION = '11.19.0'
const BUNDLED_RUNTIME_POLICY_VERSION = 2
const REGISTRY_METADATA = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
const INSTALL_SCRIPT_POLICY = {
  '@deepseek-ai/dsh-subprocess-local': true,
  '@google/genai': true,
  koffi: true,
  'node-pty': true,
  protobufjs: true,
} as const

export interface HarnessRuntimeCandidate {
  version: string
  entryPath: string
  source: 'bundled' | 'managed'
  pending: boolean
}

export interface RuntimeUpdateView {
  status: HarnessUpdateStatus
  version?: string
  message?: string
}

interface RegistryMetadata {
  'dist-tags'?: Record<string, string>
}

export class HarnessRuntimeManager extends EventEmitter {
  private readonly versionsRoot: string
  private readonly stagingRoot: string
  private readonly statePath: string
  private readonly npmCache: string
  private state: HarnessRuntimeState | undefined
  private bundled: HarnessRuntimeCandidate | undefined
  private updateView: RuntimeUpdateView = { status: 'idle' }
  private updatePromise: Promise<void> | undefined
  private updateTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly userDataPath: string,
    private readonly electronExecutable: string,
    private readonly bundledRuntimeRoot?: string,
    private readonly bundledArchivePath?: string,
    private readonly packagedNpmCli?: string,
  ) {
    super()
    const runtimeRoot = join(userDataPath, 'harness-runtime')
    this.versionsRoot = join(runtimeRoot, 'versions')
    this.stagingRoot = join(runtimeRoot, 'staging')
    this.statePath = join(runtimeRoot, 'state.json')
    this.npmCache = join(runtimeRoot, 'npm-cache')
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.versionsRoot, { recursive: true }),
      mkdir(this.stagingRoot, { recursive: true }),
      mkdir(this.npmCache, { recursive: true }),
    ])
    this.state = await readRuntimeState(this.statePath)
    await this.ensureBundledRuntimeExtracted()
    this.bundled = await this.resolveBundledRuntime()
  }

  get harnessHome(): string {
    const configuredHome = process.env.DSH_HOME?.trim()
    return configuredHome === undefined || configuredHome.length === 0
      ? join(homedir(), '.dsh')
      : configuredHome
  }

  get updateState(): RuntimeUpdateView {
    return { ...this.updateView }
  }

  async launchCandidates(): Promise<HarnessRuntimeCandidate[]> {
    const state = this.mustState()
    const bundled = this.mustBundled()
    const candidates: HarnessRuntimeCandidate[] = []

    if (state.pendingVersion !== undefined && state.badVersions[state.pendingVersion] === undefined) {
      const pending = this.managedCandidate(state.pendingVersion, true)
      if (await this.isCandidatePresent(pending)) candidates.push(pending)
    }

    if (state.activeVersion !== undefined && state.badVersions[state.activeVersion] === undefined) {
      const active = this.managedCandidate(state.activeVersion, false)
      if (
        semver.gte(active.version, bundled.version)
        && await this.isCandidatePresent(active)
        && !candidates.some((candidate) => candidate.version === active.version)
      ) {
        candidates.push(active)
      }
    }

    candidates.push(bundled)
    for (const candidate of candidates) {
      // Apply the narrowly-scoped rc.6 fix to every launch candidate. In
      // development the bundled candidate lives in the project pnpm store,
      // while packaged and managed candidates live under userData.
      await applyHarnessRuntimeCompatibility(candidate.entryPath)
    }
    return candidates
  }

  async markHealthy(candidate: HarnessRuntimeCandidate): Promise<void> {
    if (candidate.source !== 'managed') return
    const state = this.mustState()
    state.activeVersion = candidate.version
    if (state.pendingVersion === candidate.version) delete state.pendingVersion
    delete state.badVersions[candidate.version]
    await this.persistState()
  }

  async markFailed(candidate: HarnessRuntimeCandidate, reason: string): Promise<void> {
    if (candidate.source !== 'managed') return
    const state = this.mustState()
    state.badVersions[candidate.version] = {
      failedAt: new Date().toISOString(),
      reason: reason.slice(0, 1_000),
    }
    if (state.pendingVersion === candidate.version) delete state.pendingVersion
    if (state.activeVersion === candidate.version) delete state.activeVersion
    await this.persistState()
  }

  scheduleAutomaticChecks(initialDelayMs = 15_000): void {
    if (this.updateTimer !== undefined) clearTimeout(this.updateTimer)
    const run = (): void => {
      void this.checkForUpdates().finally(() => {
        this.updateTimer = setTimeout(run, UPDATE_INTERVAL_MS)
        this.updateTimer.unref()
      })
    }
    this.updateTimer = setTimeout(run, initialDelayMs)
    this.updateTimer.unref()
  }

  stopAutomaticChecks(): void {
    if (this.updateTimer !== undefined) clearTimeout(this.updateTimer)
    this.updateTimer = undefined
  }

  checkForUpdates(): Promise<void> {
    if (this.updatePromise !== undefined) return this.updatePromise
    this.updatePromise = this.performUpdateCheck().finally(() => { this.updatePromise = undefined })
    return this.updatePromise
  }

  private async performUpdateCheck(): Promise<void> {
    this.setUpdateView({ status: 'checking' })
    try {
      const response = await fetch(REGISTRY_METADATA, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
      const metadata = await response.json() as RegistryMetadata
      const targetVersion = metadata['dist-tags']?.latest
      if (targetVersion === undefined || semver.valid(targetVersion) === null) {
        throw new Error('npm registry did not return a valid latest version')
      }

      const state = this.mustState()
      state.lastCheckAt = new Date().toISOString()
      const currentVersions = [this.mustBundled().version, state.activeVersion, state.pendingVersion]
        .filter((value): value is string => value !== undefined && semver.valid(value) !== null)
      const currentVersion = currentVersions.sort(semver.rcompare)[0] ?? this.mustBundled().version

      if (!semver.gt(targetVersion, currentVersion)) {
        await this.persistState()
        this.setUpdateView({ status: 'current', version: currentVersion })
        return
      }

      this.setUpdateView({ status: 'downloading', version: targetVersion })
      await this.installVersion(targetVersion)
      state.pendingVersion = targetVersion
      delete state.badVersions[targetVersion]
      await this.persistState()
      this.setUpdateView({ status: 'ready', version: targetVersion, message: '将在下次启动时自动应用' })
    } catch (error) {
      this.setUpdateView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  private async installVersion(version: string): Promise<void> {
    const finalPath = join(this.versionsRoot, version)
    if (await this.isCandidatePresent(this.managedCandidate(version, true))) return

    const stagingPath = join(this.stagingRoot, `${version}-${Date.now()}-${process.pid}`)
    await mkdir(stagingPath, { recursive: true })
    try {
      await writeFile(join(stagingPath, 'package.json'), `${JSON.stringify({
        name: 'deepseek-harness-managed-runtime',
        private: true,
        allowScripts: INSTALL_SCRIPT_POLICY,
      }, null, 2)}\n`, 'utf8')
      await this.runNode(this.resolveNpmCli(), [
        'install', '--prefix', stagingPath, '--omit=dev', '--no-audit', '--no-fund', '--no-save',
        '--package-lock=false', '--strict-allow-scripts=true', `${HARNESS_PACKAGE}@${version}`,
        `pnpm@${DESKTOP_PNPM_VERSION}`,
      ])
      const stagedEntry = join(stagingPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const stagedPnpmEntry = join(stagingPath, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
      await Promise.all([access(stagedEntry), access(stagedPnpmEntry)])
      await applyHarnessRuntimeCompatibility(stagedEntry)
      await this.runNode(stagedEntry, ['--version'])
      await rm(finalPath, { recursive: true, force: true })
      await rename(stagingPath, finalPath)
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
  }

  private runNode(entryPath: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.electronExecutable, [entryPath, ...args], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ELECTRON_NO_ATTACH_CONSOLE: '1',
          npm_config_cache: this.npmCache,
          npm_config_update_notifier: 'false',
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000) })
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`runtime command failed (${String(code ?? signal)}): ${stderr.trim()}`))
      })
    })
  }

  private resolveNpmCli(): string {
    return this.packagedNpmCli ?? join(dirname(require.resolve('npm/package.json')), 'bin', 'npm-cli.js')
  }

  private async ensureBundledRuntimeExtracted(): Promise<void> {
    if (this.bundledRuntimeRoot === undefined || this.bundledArchivePath === undefined) return
    const entryPath = join(this.bundledRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const pnpmEntryPath = join(this.bundledRuntimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    const receiptPath = join(this.bundledRuntimeRoot, '.desktop-runtime.json')
    try {
      const [, , receiptText] = await Promise.all([
        access(entryPath),
        access(pnpmEntryPath),
        readFile(receiptPath, 'utf8'),
      ])
      const receipt = JSON.parse(receiptText) as { pnpmVersion?: unknown; policyVersion?: unknown }
      if (
        receipt.pnpmVersion !== DESKTOP_PNPM_VERSION
        || receipt.policyVersion !== BUNDLED_RUNTIME_POLICY_VERSION
      ) throw new Error('Bundled runtime policy is stale')
      return
    } catch {
      // A runtime directory may predate a toolchain-policy change even when the
      // desktop version is unchanged. Re-extract instead of asking users to
      // delete userData manually.
    }

    const stagingPath = `${this.bundledRuntimeRoot}.staging-${process.pid}`
    await rm(stagingPath, { recursive: true, force: true })
    await mkdir(stagingPath, { recursive: true })
    try {
      await extractTar({
        cwd: stagingPath,
        file: this.bundledArchivePath,
        preservePaths: false,
        strict: true,
      })
      await access(join(stagingPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      await access(join(stagingPath, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
      await rm(this.bundledRuntimeRoot, { recursive: true, force: true })
      await mkdir(dirname(this.bundledRuntimeRoot), { recursive: true })
      await rename(stagingPath, this.bundledRuntimeRoot)
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
  }

  private async resolveBundledRuntime(): Promise<HarnessRuntimeCandidate> {
    const entryPath = this.bundledRuntimeRoot === undefined
      ? require.resolve('@deepseek-ai/dsh/lib/bin.js')
      : join(this.bundledRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    await access(entryPath)
    const manifest = JSON.parse(await readFile(join(dirname(dirname(entryPath)), 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string' || semver.valid(manifest.version) === null) {
      throw new Error('The bundled DeepSeek Harness has no valid version')
    }
    return { version: manifest.version, entryPath, source: 'bundled', pending: false }
  }

  private managedCandidate(version: string, pending: boolean): HarnessRuntimeCandidate {
    return {
      version,
      entryPath: join(this.versionsRoot, version, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      source: 'managed',
      pending,
    }
  }

  private async isCandidatePresent(candidate: HarnessRuntimeCandidate): Promise<boolean> {
    try { await access(candidate.entryPath); return true } catch { return false }
  }

  private mustState(): HarnessRuntimeState {
    if (this.state === undefined) throw new Error('HarnessRuntimeManager has not been initialized')
    return this.state
  }

  private mustBundled(): HarnessRuntimeCandidate {
    if (this.bundled === undefined) throw new Error('HarnessRuntimeManager has not been initialized')
    return this.bundled
  }

  private async persistState(): Promise<void> {
    await writeRuntimeState(this.statePath, this.mustState())
  }

  private setUpdateView(view: RuntimeUpdateView): void {
    this.updateView = view
    this.emit('update-state', this.updateState)
  }
}
