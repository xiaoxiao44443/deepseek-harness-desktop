import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessDesktopBridgeHost } from './src/main/harness-desktop-bridge.js'
import { apply, createRestartTool, STATIC_GUIDANCE } from './resources/dsh-desktop-bridge/lib/index.js'

const hosts: HarnessDesktopBridgeHost[] = []
const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(async (host) => await host.stop()))
  await Promise.all(temporaryPaths.splice(0).map(async (path) => await rm(path, { recursive: true, force: true })))
})

describe('HarnessDesktopBridgeHost', () => {
  it('writes a private patch and accepts only authenticated restart requests', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'dsh-desktop-bridge-'))
    temporaryPaths.push(userDataPath)
    const restartHarness = vi.fn(async () => undefined)
    const host = new HarnessDesktopBridgeHost({
      userDataPath,
      pluginEntryPath: '/private/example/dsh-desktop-bridge/lib/index.js',
      profilePath: '/private/example/.dsh/profiles/web',
      restartHarness,
      restartDelayMs: 5,
    })
    hosts.push(host)

    const launch = await host.start()
    const patch = JSON.parse(await readFile(launch.patchPath, 'utf8')) as Array<{
      insert: Array<{ id: string; name: string }>
    }>
    expect(patch).toEqual([{
      insert: [{
        id: 'desktop-bridge',
        name: '/private/example/dsh-desktop-bridge/lib/index.js',
      }],
    }])

    const denied = await fetch(launch.controlUrl, { method: 'POST' })
    expect(denied.status).toBe(401)
    expect(restartHarness).not.toHaveBeenCalled()

    const accepted = await fetch(launch.controlUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${launch.controlToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '加载 greet' }),
    })
    expect(accepted.status).toBe(202)
    await vi.waitFor(() => expect(restartHarness).toHaveBeenCalledWith('加载 greet'))
  })
})

describe('@saltfish/dsh-desktop-bridge tool', () => {
  it('tells the model to call tools already present in the current request directly', () => {
    expect(STATIC_GUIDANCE).toContain('authoritative callable set for this same turn')
    expect(STATIC_GUIDANCE).toContain('call it directly now')
    expect(STATIC_GUIDANCE).toContain('do not inspect the registry first')
    expect(STATIC_GUIDANCE).toContain('first resumed user turn already receives the rebuilt callable set')
  })

  it('explains desktop Patch overlays without presenting them as plugin installation', () => {
    expect(STATIC_GUIDANCE).toContain('dsh web --patch <file>')
    expect(STATIC_GUIDANCE).toContain('not a separate debug runtime')
    expect(STATIC_GUIDANCE).toContain('does not install dependencies')
    expect(STATIC_GUIDANCE).toContain('dsh plugin --profile web add <package>')
  })

  it('requests the authenticated desktop restart and concludes the current turn', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }))
    const concludeTurn = vi.fn()
    const tool = createRestartTool('http://127.0.0.1:12345/v1/restart-harness', 'secret', fetchImpl)

    await expect(tool.execute({ reason: '加载 greet' }, { concludeTurn })).resolves.toContain('自动重新连接')
    expect(concludeTurn).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:12345/v1/restart-harness',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
        body: JSON.stringify({ reason: '加载 greet' }),
      }),
    )
  })

  it('does not conclude the turn when the desktop rejects the request', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      accepted: false,
      message: 'restart unavailable',
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }))
    const concludeTurn = vi.fn()
    const tool = createRestartTool('http://127.0.0.1:12345/v1/restart-harness', 'secret', fetchImpl)

    await expect(tool.execute({}, { concludeTurn })).rejects.toThrow('restart unavailable')
    expect(concludeTurn).not.toHaveBeenCalled()
  })

  it('publishes restart-required context after the active Profile changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-'))
    temporaryPaths.push(root)
    const profilePath = join(root, 'profiles', 'web')
    await mkdir(profilePath, { recursive: true })
    await writeFile(join(profilePath, 'package.json'), '{"dependencies":{}}\n', 'utf8')

    const registeredContexts: Array<{ text: () => string }> = []
    const emit = vi.fn()
    const cleanup = await apply({
      tools: { register: vi.fn() },
      systemPrompt: {
        section: vi.fn(),
        context: vi.fn((context: { text: () => string }) => { registeredContexts.push(context) }),
      },
      on: vi.fn(),
      emit,
    }, {
      controlUrl: 'http://127.0.0.1:12345/v1/restart-harness',
      controlToken: 'secret',
      profilePath,
    })

    expect(registeredContexts[0]?.text()).toBe('')
    await writeFile(join(profilePath, 'package.json'), '{"dependencies":{"greet":"1.0.0"}}\n', 'utf8')
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('system-prompt/change'))
    expect(registeredContexts[0]?.text()).toContain('active web Profile changed')
    cleanup()
  })
})
