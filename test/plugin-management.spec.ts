import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyPluginSource, PluginManagementService } from '../src/main/plugin-management.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

describe('PluginManagementService', () => {
  it('ignores dependency storage and directories without a Profile manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-profiles-'))
    roots.push(root)
    const harnessHome = join(root, 'home')
    const profilesRoot = join(harnessHome, 'profiles')
    await mkdir(join(profilesRoot, 'web'), { recursive: true })
    await mkdir(join(profilesRoot, 'node_modules'), { recursive: true })
    await mkdir(join(profilesRoot, 'cache'), { recursive: true })
    await writeFile(join(profilesRoot, 'web', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: [] } },
    }))
    await writeFile(join(profilesRoot, 'node_modules', 'package.json'), JSON.stringify({
      name: 'dependency-storage',
    }))

    const service = new PluginManagementService(harnessHome, {
      getWindow: () => undefined,
      runPlugin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })

    expect((await service.getInventory()).profiles.map((profile) => profile.name)).toEqual(['web'])
  })

  it('separates built-in, local, registry, and inactive dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-management-'))
    roots.push(root)
    const harnessHome = join(root, 'home')
    const profileDir = join(harnessHome, 'profiles', 'web')
    const localPlugin = join(root, 'plugins', 'local-plugin')
    const npmPlugin = join(profileDir, 'node_modules', '@sample', 'npm-plugin')
    await mkdir(profileDir, { recursive: true })
    await mkdir(localPlugin, { recursive: true })
    await mkdir(npmPlugin, { recursive: true })
    await writeFile(join(localPlugin, 'package.json'), JSON.stringify({
      name: '@sample/local-plugin',
      version: '1.2.3',
      description: 'Local plugin',
    }))
    await writeFile(join(npmPlugin, 'package.json'), JSON.stringify({
      name: '@sample/npm-plugin',
      version: '4.5.6',
      description: 'Registry plugin',
    }))
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@sample/local-plugin', '@sample/npm-plugin'] } },
      dependencies: {
        '@sample/local-plugin': `link:${localPlugin}`,
        '@sample/npm-plugin': '^4.0.0',
        '@sample/missing-library': '^1.0.0',
      },
    }))

    const service = new PluginManagementService(harnessHome, {
      getWindow: () => undefined,
      runPlugin: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })
    const inventory = await service.getInventory()
    const plugins = inventory.profiles[0]?.plugins ?? []

    expect(inventory.profiles.map((profile) => profile.name)).toEqual(['web'])
    expect(plugins).toMatchObject([
      { name: '@deepseek-ai/dsh-base', sourceType: 'builtin', active: true, removable: false, status: 'ready' },
      { name: '@sample/local-plugin', sourceType: 'local', version: '1.2.3', active: true, status: 'ready' },
      { name: '@sample/npm-plugin', sourceType: 'npm', version: '4.5.6', active: true, status: 'ready' },
      { name: '@sample/missing-library', sourceType: 'npm', active: false, status: 'missing' },
    ])
  })

  it('forwards safe install and remove operations to dsh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-commands-'))
    roots.push(root)
    const harnessHome = join(root, 'home')
    const profileDir = join(harnessHome, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: [] } },
      dependencies: { '@sample/plugin': 'github:sample/plugin' },
    }))
    const calls: Array<{ profile: string; args: string[] }> = []
    const service = new PluginManagementService(harnessHome, {
      getWindow: () => undefined,
      runPlugin: async (profile, args) => {
        calls.push({ profile, args })
        return { exitCode: 0, stdout: 'done', stderr: '' }
      },
    })

    const installed = await service.install({ profile: 'web', source: '/tmp/My Plugin' })
    const removed = await service.remove({ profile: 'web', packageName: '@sample/plugin' })

    expect(calls).toEqual([
      { profile: 'web', args: ['add', '/tmp/My Plugin'] },
      { profile: 'web', args: ['remove', '@sample/plugin'] },
    ])
    expect(installed.command).toBe('dsh plugin --profile web add "/tmp/My Plugin"')
    expect(removed.output).toBe('done')
  })
})

describe('classifyPluginSource', () => {
  it('recognizes the supported source families', () => {
    expect(classifyPluginSource(undefined)).toBe('builtin')
    expect(classifyPluginSource('link:../plugin')).toBe('local')
    expect(classifyPluginSource('workspace:*')).toBe('workspace')
    expect(classifyPluginSource('github:owner/repo')).toBe('git')
    expect(classifyPluginSource('git@github.com:owner/repo.git')).toBe('git')
    expect(classifyPluginSource('https://github.com/owner/repo.git')).toBe('git')
    expect(classifyPluginSource('@scope/plugin@^1.0.0')).toBe('npm')
  })
})
