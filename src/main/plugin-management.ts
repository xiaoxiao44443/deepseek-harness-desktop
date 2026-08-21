import { access, readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type {
  ManagedPluginEntry,
  PluginInstallRequest,
  PluginInventory,
  PluginMutationResult,
  PluginProfileInventory,
  PluginRemoveRequest,
  PluginSourceType,
} from '../shared/contracts.js'
import type { HarnessCommandResult } from './harness-process.js'

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}

interface PackageMetadata {
  version?: string
  description?: string
}

export interface PluginManagementActions {
  getWindow(): BrowserWindow | undefined
  runPlugin(profile: string, args: string[]): Promise<HarnessCommandResult>
}

export class PluginManagementService {
  private commandRunning = false

  constructor(
    private readonly harnessHome: string,
    private readonly actions: PluginManagementActions,
  ) {}

  async getInventory(): Promise<PluginInventory> {
    const profilesRoot = join(this.harnessHome, 'profiles')
    let directories: Dirent<string>[]
    try {
      directories = await readdir(profilesRoot, { withFileTypes: true })
    } catch (error) {
      if (isMissingFileError(error)) return { profiles: [], scannedAt: new Date().toISOString() }
      throw error
    }

    const profileNames = (await Promise.all(directories
      .filter((entry) => entry.name !== 'node_modules' && (entry.isDirectory() || entry.isSymbolicLink()))
      .map(async (entry) => await hasProfileManifest(join(profilesRoot, entry.name)) ? entry.name : undefined)))
      .filter((name): name is string => name !== undefined)
      .sort((left, right) => left === 'web' ? -1 : right === 'web' ? 1 : left.localeCompare(right))
    const profiles = await Promise.all(profileNames.map((name) => this.readProfile(name)))
    return { profiles, scannedAt: new Date().toISOString() }
  }

  async chooseLocalDirectory(): Promise<string | undefined> {
    const owner = this.actions.getWindow()
    if (owner === undefined || owner.isDestroyed()) return undefined
    const result = await dialog.showOpenDialog(owner, {
      title: '选择本地 DSH 插件目录',
      properties: ['openDirectory'],
    })
    if (result.canceled) return undefined
    return result.filePaths[0]
  }

  async install(request: PluginInstallRequest): Promise<PluginMutationResult> {
    const profile = validateProfileName(request.profile)
    const source = request.source.trim()
    if (source.length === 0) throw new Error('请填写 npm 包名、Git 仓库地址或本地插件目录。')
    if (source.length > 2_000 || /[\r\n\0]/u.test(source)) throw new Error('插件来源无效。')
    return await this.run(profile, ['add', source])
  }

  async remove(request: PluginRemoveRequest): Promise<PluginMutationResult> {
    const profile = validateProfileName(request.profile)
    const packageName = request.packageName.trim()
    if (!PACKAGE_NAME_PATTERN.test(packageName)) throw new Error('插件包名无效。')
    const manifest = await this.readManifest(join(this.harnessHome, 'profiles', profile, 'package.json'))
    if (manifest.dependencies?.[packageName] === undefined) {
      throw new Error(`“${packageName}”不是 ${profile} Profile 中可移除的外部插件。`)
    }
    return await this.run(profile, ['remove', packageName])
  }

  private async readProfile(name: string): Promise<PluginProfileInventory> {
    const profileDir = join(this.harnessHome, 'profiles', name)
    try {
      const manifest = await this.readManifest(join(profileDir, 'package.json'))
      const dependencies = manifest.dependencies ?? {}
      const bundles = manifest.dsh?.profile?.bundles?.filter((entry): entry is string => typeof entry === 'string') ?? []
      const dependencyOnly = Object.keys(dependencies).filter((entry) => !bundles.includes(entry)).sort()
      const names = [...new Set([...bundles, ...dependencyOnly])]
      const plugins = await Promise.all(names.map((packageName) => this.readPlugin(
        profileDir,
        packageName,
        dependencies[packageName],
        bundles.includes(packageName),
      )))
      return { name, plugins }
    } catch (error) {
      return {
        name,
        plugins: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async readPlugin(
    profileDir: string,
    packageName: string,
    dependencySpec: string | undefined,
    active: boolean,
  ): Promise<ManagedPluginEntry> {
    const sourceType = classifyPluginSource(dependencySpec)
    const metadata = await this.readPackageMetadata(profileDir, packageName, dependencySpec)
    return {
      name: packageName,
      ...(metadata?.version === undefined ? {} : { version: metadata.version }),
      ...(metadata?.description === undefined ? {} : { description: metadata.description }),
      sourceType,
      source: dependencySpec ?? '随 Harness 提供',
      active,
      removable: dependencySpec !== undefined,
      status: dependencySpec !== undefined && metadata === undefined ? 'missing' : 'ready',
    }
  }

  private async readPackageMetadata(
    profileDir: string,
    packageName: string,
    dependencySpec: string | undefined,
  ): Promise<PackageMetadata | undefined> {
    if (PACKAGE_NAME_PATTERN.test(packageName)) {
      const installed = await readMetadataFile(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'))
      if (installed !== undefined) return installed
    }
    const localPath = resolveLocalSource(profileDir, dependencySpec)
    if (localPath === undefined) return undefined
    return await readMetadataFile(join(localPath, 'package.json'))
  }

  private async readManifest(path: string): Promise<ProfileManifest> {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Profile 配置不是有效对象：${path}`)
    }
    return parsed as ProfileManifest
  }

  private async run(profile: string, args: string[]): Promise<PluginMutationResult> {
    if (this.commandRunning) throw new Error('已有插件操作正在运行。')
    this.commandRunning = true
    try {
      const result = await this.actions.runPlugin(profile, args)
      return {
        inventory: await this.getInventory(),
        command: `dsh plugin --profile ${formatDisplayArgument(profile)} ${args.map(formatDisplayArgument).join(' ')}`,
        output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n') || '(没有输出)',
        exitCode: result.exitCode,
      }
    } finally {
      this.commandRunning = false
    }
  }
}

export function classifyPluginSource(spec: string | undefined): PluginSourceType {
  if (spec === undefined) return 'builtin'
  if (/^(?:link|file):/iu.test(spec) || isAbsolute(spec)) return 'local'
  if (/^workspace:/iu.test(spec)) return 'workspace'
  if (/^(?:git(?:\+[^:]+)?|github|gitlab|bitbucket):/iu.test(spec)
    || /^git@[^:]+:/iu.test(spec)
    || /^(?:https?|ssh):\/\//iu.test(spec) && /(?:github|gitlab|bitbucket|\.git(?:#|$))/iu.test(spec)
    || /^[^/@\s]+\/[^/\s]+(?:#.*)?$/u.test(spec)) return 'git'
  if (spec.length > 0) return 'npm'
  return 'unknown'
}

function resolveLocalSource(profileDir: string, spec: string | undefined): string | undefined {
  if (spec === undefined) return undefined
  const match = /^(?:link|file):(.*)$/iu.exec(spec)
  const candidate = match?.[1] ?? (isAbsolute(spec) ? spec : undefined)
  if (candidate === undefined || candidate.length === 0) return undefined
  return isAbsolute(candidate) ? candidate : resolve(profileDir, candidate)
}

async function readMetadataFile(path: string): Promise<PackageMetadata | undefined> {
  try {
    await access(path)
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    return {
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
    }
  } catch {
    return undefined
  }
}

async function hasProfileManifest(profileDir: string): Promise<boolean> {
  try {
    await access(join(profileDir, 'package.json'))
    return true
  } catch (error) {
    return !isMissingFileError(error)
  }
}

function validateProfileName(value: string): string {
  const profile = value.trim()
  if (profile.length === 0) throw new Error('请选择 Profile。')
  if (profile.length > 120 || /[\\/\r\n\0]/u.test(profile) || profile === '.' || profile === '..') {
    throw new Error('Profile 名称无效。')
  }
  return profile
}

function formatDisplayArgument(value: string): string {
  return /\s|["']/u.test(value) ? JSON.stringify(value) : value
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
