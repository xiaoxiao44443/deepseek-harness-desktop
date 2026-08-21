import { constants } from 'node:fs'
import { access, lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'
import type { DevelopmentCliState } from '../shared/contracts.js'

type CliPlatform = NodeJS.Platform
type CliState = Omit<DevelopmentCliState, 'changing'>

export interface WindowsUserPathStore {
  read(): Promise<string>
  write(value: string): Promise<void>
}

export interface DshCliIntegrationOptions {
  platform?: CliPlatform
  macCommandPath?: string
  windowsUserPath?: WindowsUserPathStore
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function runPowerShell(script: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const executable = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

  return new Promise((resolveOutput, reject) => {
    execFile(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', env: env ?? process.env, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolveOutput(stdout.trim())
      }
    )
  })
}

function defaultWindowsUserPathStore(): WindowsUserPathStore {
  return {
    read: () =>
      runPowerShell(
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); [Environment]::GetEnvironmentVariable('Path', 'User')"
      ),
    write: async (value) => {
      await runPowerShell(
        "[Environment]::SetEnvironmentVariable('Path', $env:DFY_DSH_DESKTOP_USER_PATH, 'User')",
        { ...process.env, DFY_DSH_DESKTOP_USER_PATH: value }
      )
    }
  }
}

function windowsPathEquals(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.trim().replace(/^"(.*)"$/, '$1')
    return win32.normalize(trimmed).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
  }
  return normalize(left) === normalize(right)
}

function splitWindowsPath(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export class DshCliIntegration {
  private readonly platform: CliPlatform
  private readonly macCommandPath: string
  private readonly windowsUserPath: WindowsUserPathStore
  private current: CliState

  constructor(
    private readonly toolchainBinPath: string,
    private readonly dshCommandPath: string,
    options: DshCliIntegrationOptions = {}
  ) {
    this.platform = options.platform ?? process.platform
    this.macCommandPath = options.macCommandPath ?? '/usr/local/bin/dsh'
    this.windowsUserPath = options.windowsUserPath ?? defaultWindowsUserPathStore()
    this.current = {
      status: 'unavailable',
      commandPath: this.platform === 'darwin' ? this.macCommandPath : this.dshCommandPath,
      message: 'Harness 开发工具尚未准备完成'
    }
  }

  get state(): CliState {
    return { ...this.current }
  }

  async refresh(): Promise<CliState> {
    try {
      if (this.platform === 'darwin') {
        this.current = await this.readMacState()
      } else if (this.platform === 'win32') {
        this.current = await this.readWindowsState()
      } else {
        this.current = {
          status: 'unsupported',
          commandPath: this.dshCommandPath,
          message: '当前平台暂不支持启用终端 dsh'
        }
      }
    } catch (error) {
      this.current = {
        status: 'error',
        commandPath: this.platform === 'darwin' ? this.macCommandPath : this.dshCommandPath,
        message: error instanceof Error ? error.message : String(error)
      }
    }
    return this.state
  }

  async setEnabled(enabled: boolean): Promise<CliState> {
    if (this.platform === 'darwin') {
      await this.setMacEnabled(enabled)
    } else if (this.platform === 'win32') {
      await this.setWindowsEnabled(enabled)
    } else {
      throw new Error('当前平台暂不支持启用终端 dsh')
    }
    return this.refresh()
  }

  private async readMacState(): Promise<CliState> {
    const targetReady = await pathExists(this.dshCommandPath)
    let commandStat
    try {
      commandStat = await lstat(this.macCommandPath)
    } catch (error) {
      if (!isNotFound(error)) throw error
      return targetReady
        ? {
            status: 'disabled',
            commandPath: this.macCommandPath,
            message: `启用后可在终端直接运行 dsh`
          }
        : {
            status: 'unavailable',
            commandPath: this.macCommandPath,
            message: 'Harness 开发工具尚未准备完成'
          }
    }

    if (!commandStat.isSymbolicLink()) {
      return {
        status: 'conflict',
        commandPath: this.macCommandPath,
        message: `${this.macCommandPath} 已被其他文件占用`
      }
    }

    const linkTarget = resolve(dirname(this.macCommandPath), await readlink(this.macCommandPath))
    if (linkTarget !== resolve(this.dshCommandPath)) {
      return {
        status: 'conflict',
        commandPath: this.macCommandPath,
        message: `${this.macCommandPath} 已指向其他 dsh`
      }
    }

    return targetReady
      ? {
          status: 'enabled',
          commandPath: this.macCommandPath,
          message: `${this.macCommandPath} 使用桌面端 DSH`
        }
      : {
          status: 'broken',
          commandPath: this.macCommandPath,
          message: '终端入口已启用，但 Harness 开发工具尚未准备完成'
        }
  }

  private async setMacEnabled(enabled: boolean): Promise<void> {
    const state = await this.readMacState()
    if (enabled) {
      if (state.status === 'enabled') return
      if (state.status === 'conflict') throw new Error(state.message)
      if (!(await pathExists(this.dshCommandPath))) {
        throw new Error('Harness 开发工具尚未准备完成')
      }
      await mkdir(dirname(this.macCommandPath), { recursive: true })
      await symlink(this.dshCommandPath, this.macCommandPath)
      return
    }

    if (state.status === 'conflict') throw new Error(state.message)
    if (state.status === 'enabled' || state.status === 'broken') {
      await unlink(this.macCommandPath)
    }
  }

  private async readWindowsState(): Promise<CliState> {
    const targetReady = await pathExists(this.dshCommandPath)
    const userPath = await this.windowsUserPath.read()
    const enabled = splitWindowsPath(userPath).some((entry) => windowsPathEquals(entry, this.toolchainBinPath))

    if (enabled) {
      return targetReady
        ? {
            status: 'enabled',
            commandPath: this.dshCommandPath,
            message: '桌面端 DSH 已加入用户 PATH；新终端会自动生效'
          }
        : {
            status: 'broken',
            commandPath: this.dshCommandPath,
            message: '用户 PATH 已配置，但 Harness 开发工具尚未准备完成'
          }
    }

    return targetReady
      ? {
          status: 'disabled',
          commandPath: this.dshCommandPath,
          message: '启用后，新终端可直接运行 dsh'
        }
      : {
          status: 'unavailable',
          commandPath: this.dshCommandPath,
          message: 'Harness 开发工具尚未准备完成'
        }
  }

  private async setWindowsEnabled(enabled: boolean): Promise<void> {
    if (enabled && !(await pathExists(this.dshCommandPath))) {
      throw new Error('Harness 开发工具尚未准备完成')
    }

    const userPath = await this.windowsUserPath.read()
    const entries = splitWindowsPath(userPath).filter(
      (entry) => !windowsPathEquals(entry, this.toolchainBinPath)
    )
    if (enabled) entries.unshift(this.toolchainBinPath)
    await this.windowsUserPath.write(entries.join(';'))
  }
}
