import { EventEmitter } from 'node:events'
import { dialog, type BrowserWindow } from 'electron'
import type { DevelopmentPluginRequest, DevelopmentState } from '../shared/contracts.js'
import { readDevelopmentSettings, writeDevelopmentSettings, type DevelopmentSettings } from './development-settings.js'
import type { HarnessCommandResult } from './harness-process.js'
import { parseCommandArguments } from './command-arguments.js'

export interface DevelopmentServiceActions {
  getWindow(): BrowserWindow | undefined
  restartHarness(settings: DevelopmentSettings): Promise<void>
  runPlugin(profile: string, args: string[]): Promise<HarnessCommandResult>
}

export class DevelopmentService extends EventEmitter {
  private settings: DevelopmentSettings = {}
  private restarting = false
  private commandRunning = false
  private dshVersion: string | undefined
  private lastCommand: string | undefined
  private commandOutput: string | undefined
  private lastExitCode: number | undefined

  constructor(
    private readonly settingsPath: string,
    private readonly pnpmVersion: string,
    private readonly actions: DevelopmentServiceActions,
  ) { super() }

  async initialize(): Promise<void> {
    this.settings = await readDevelopmentSettings(this.settingsPath)
  }

  get state(): DevelopmentState {
    return {
      ...(this.settings.patchPath !== undefined ? { patchPath: this.settings.patchPath } : {}),
      ...(this.dshVersion !== undefined ? { dshVersion: this.dshVersion } : {}),
      pnpmVersion: this.pnpmVersion,
      restarting: this.restarting,
      commandRunning: this.commandRunning,
      ...(this.lastCommand !== undefined ? { lastCommand: this.lastCommand } : {}),
      ...(this.commandOutput !== undefined ? { commandOutput: this.commandOutput } : {}),
      ...(this.lastExitCode !== undefined ? { lastExitCode: this.lastExitCode } : {}),
    }
  }

  get currentSettings(): DevelopmentSettings {
    return { ...this.settings }
  }

  setHarnessVersion(version: string): void {
    this.dshVersion = version
    this.publish()
  }

  async choosePatch(): Promise<void> {
    const owner = this.actions.getWindow()
    if (owner === undefined || owner.isDestroyed()) return
    const result = await dialog.showOpenDialog(owner, {
      title: '选择 Harness Patch 配置',
      ...(this.settings.patchPath !== undefined ? { defaultPath: this.settings.patchPath } : {}),
      properties: ['openFile'],
      filters: [
        { name: 'Harness Patch 配置', extensions: ['yml', 'yaml', 'json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    const patchPath = result.filePaths[0]
    if (result.canceled || patchPath === undefined) return
    this.settings = { patchPath }
    await writeDevelopmentSettings(this.settingsPath, this.settings)
    this.publish()
  }

  async clearPatch(): Promise<void> {
    this.settings = {}
    await writeDevelopmentSettings(this.settingsPath, this.settings)
    this.publish()
  }

  async restartHarness(): Promise<void> {
    if (this.restarting) return
    this.restarting = true
    this.publish()
    try {
      await this.actions.restartHarness(this.settings)
    } finally {
      this.restarting = false
      this.publish()
    }
  }

  async runPlugin(request: DevelopmentPluginRequest): Promise<void> {
    if (this.commandRunning) return
    const profile = request.profile.trim()
    if (profile.length === 0) throw new Error('请填写 Profile 名称。')
    if (profile.length > 120 || /[\r\n\0]/u.test(profile)) throw new Error('Profile 名称无效。')
    const args = parseCommandArguments(request.argumentsText)
    if (args.length === 0) throw new Error('请填写要传给 pnpm 的参数，例如 add ./scratch-plugin。')

    this.commandRunning = true
    this.lastCommand = `dsh plugin --profile ${profile} ${args.map(formatDisplayArgument).join(' ')}`
    this.commandOutput = '正在运行…'
    this.lastExitCode = undefined
    this.publish()
    try {
      const result = await this.actions.runPlugin(profile, args)
      this.commandOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || '(没有输出)'
      this.lastExitCode = result.exitCode
    } catch (error) {
      this.commandOutput = error instanceof Error ? error.message : String(error)
      this.lastExitCode = -1
      throw error
    } finally {
      this.commandRunning = false
      this.publish()
    }
  }

  private publish(): void {
    this.emit('state', this.state)
  }
}

function formatDisplayArgument(value: string): string {
  return /\s|["']/u.test(value) ? JSON.stringify(value) : value
}
