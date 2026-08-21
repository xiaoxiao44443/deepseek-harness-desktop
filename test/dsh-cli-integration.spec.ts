import { mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DshCliIntegration, type WindowsUserPathStore } from '../src/main/dsh-cli-integration.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => rm(path, { recursive: true, force: true })))
})

async function createToolchain(suffix = ''): Promise<{ root: string; binPath: string; dshPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-cli-'))
  temporaryRoots.push(root)
  const binPath = join(root, 'toolchain', 'bin')
  const dshPath = join(binPath, `dsh${suffix}`)
  await mkdir(binPath, { recursive: true })
  await writeFile(dshPath, '')
  return { root, binPath, dshPath }
}

describe('DshCliIntegration', () => {
  it('creates and removes the stable macOS command link', async () => {
    const { root, binPath, dshPath } = await createToolchain()
    const commandPath = join(root, 'public', 'dsh')
    const cli = new DshCliIntegration(binPath, dshPath, {
      platform: 'darwin',
      macCommandPath: commandPath,
    })

    expect((await cli.refresh()).status).toBe('disabled')
    expect((await cli.setEnabled(true)).status).toBe('enabled')
    expect(await readlink(commandPath)).toBe(dshPath)
    expect((await cli.setEnabled(false)).status).toBe('disabled')
  })

  it('does not replace an existing macOS command', async () => {
    const { root, binPath, dshPath } = await createToolchain()
    const commandPath = join(root, 'public', 'dsh')
    await mkdir(join(root, 'public'), { recursive: true })
    await writeFile(commandPath, 'another dsh')
    const cli = new DshCliIntegration(binPath, dshPath, {
      platform: 'darwin',
      macCommandPath: commandPath,
    })

    expect((await cli.refresh()).status).toBe('conflict')
    await expect(cli.setEnabled(true)).rejects.toThrow('已被其他文件占用')
  })

  it('adds and removes only its toolchain directory in the Windows user PATH', async () => {
    const { binPath, dshPath } = await createToolchain('.cmd')
    let userPath = 'C:\\Tools;C:\\Windows'
    const pathStore: WindowsUserPathStore = {
      read: async () => userPath,
      write: async (value) => { userPath = value },
    }
    const cli = new DshCliIntegration(binPath, dshPath, {
      platform: 'win32',
      windowsUserPath: pathStore,
    })

    expect((await cli.refresh()).status).toBe('disabled')
    expect((await cli.setEnabled(true)).status).toBe('enabled')
    expect(userPath.split(';')[0]).toBe(binPath)
    expect((await cli.setEnabled(false)).status).toBe('disabled')
    expect(userPath).toBe('C:\\Tools;C:\\Windows')
  })
})
