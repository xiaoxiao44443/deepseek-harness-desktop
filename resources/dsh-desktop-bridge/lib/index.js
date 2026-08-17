import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'desktop-bridge'
export const inject = ['tools', 'systemPrompt']

export const RESTART_TOOL_NAME = 'desktop_restart_harness'
const PROFILE_FILES = ['package.json', 'cordis.patch.yml']
export const STATIC_GUIDANCE = `DeepSeek Harness is running inside DeepSeek Harness Desktop. The tool schemas attached to the current model request are the authoritative callable set for this same turn. If the user names a tool that is present in that set, call it directly now: do not inspect the registry first, execute its implementation through a shell, import its source, simulate it, or claim it will only be callable on a later turn. After a Harness restart, the first resumed user turn already receives the rebuilt callable set. The desktop's optional Patch configuration is equivalent to adding \`dsh web --patch <file>\`: it overlays the normal web Profile after its bundle and user layers, and takes effect after Harness restarts. A Patch is useful for local plugin development, entry enable/disable, and configuration experiments, but it is not a separate debug runtime and does not install dependencies; any package or file inserted by the Patch must already be resolvable. For durable profile plugins, use \`dsh plugin --profile web add <package>\` with a package that declares a dsh bundle. The desktop also provides the ${RESTART_TOOL_NAME} tool. Only when a requested tool is absent because a Profile plugin was installed, removed, or changed after this Harness process started, verify the current tool catalog at most once, then use ${RESTART_TOOL_NAME} instead of creating a temporary duplicate or executing the missing tool indirectly. The restart requires user approval and ends the current turn.`
const STALE_CONTEXT = `DeepSeek Harness Desktop detected that the active web Profile changed after this Harness process started. Newly installed or changed tools are not mounted in the current process. Use ${RESTART_TOOL_NAME} when the user wants those changes loaded.`

export function createRestartTool(controlUrl, controlToken, fetchImpl = fetch) {
  return {
    name: RESTART_TOOL_NAME,
    description: 'Request a user-approved restart of the Harness background process so newly installed or changed Profile plugins and tools are loaded. DeepSeek Harness Desktop reconnects the current interface after restart.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Short user-facing reason for restarting Harness.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: value }]
      },
    },
    async execute(args, exec) {
      const reason = typeof args.reason === 'string' && args.reason.trim().length > 0
        ? args.reason.trim()
        : '加载已变更的 Harness 插件配置'
      const response = await fetchImpl(controlUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${controlToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(5_000),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.accepted !== true) {
        const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`
        throw new Error(`Desktop rejected the Harness restart request: ${message}`)
      }
      exec.concludeTurn()
      return 'Harness 将立即重启并自动重新连接。重启完成后，请继续调用刚安装的工具。'
    },
  }
}

export async function apply(ctx, overrides = {}) {
  const controlUrl = overrides.controlUrl ?? process.env.DSH_DESKTOP_CONTROL_URL
  const controlToken = overrides.controlToken ?? process.env.DSH_DESKTOP_CONTROL_TOKEN
  const profilePath = overrides.profilePath ?? process.env.DSH_DESKTOP_PROFILE_PATH
  if (!controlUrl || !controlToken || !profilePath) {
    throw new Error('@saltfish/dsh-desktop-bridge requires the DeepSeek Harness Desktop environment')
  }

  ctx.tools.register(createRestartTool(controlUrl, controlToken))
  ctx.systemPrompt.section({
    name: 'desktop:restart-guidance',
    order: 185,
    text: STATIC_GUIDANCE,
  })

  let baseline = await profileFingerprint(profilePath)
  let profileChanged = false
  ctx.systemPrompt.context({
    name: 'desktop:profile-restart-required',
    order: 80,
    text: () => profileChanged ? STALE_CONTEXT : '',
  })

  ctx.on('tools/pre-execute', async (execution, next) => {
    if (execution.name !== RESTART_TOOL_NAME) return await next()
    const requestedReason = execution.arguments && typeof execution.arguments === 'object'
      && typeof execution.arguments.reason === 'string'
      ? execution.arguments.reason.trim().slice(0, 240)
      : ''
    return {
      kind: 'ask',
      reason: requestedReason.length > 0
        ? `Harness 需要重启：${requestedReason}`
        : 'Harness 需要重启以加载插件配置变更。',
    }
  })

  let refreshTimer
  const refresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      void profileFingerprint(profilePath).then((current) => {
        const changed = current !== baseline
        if (changed === profileChanged) return
        profileChanged = changed
        ctx.emit('system-prompt/change')
      })
    }, 120)
    refreshTimer.unref?.()
  }

  let watcher
  try {
    watcher = watch(profilePath, { persistent: false }, (_event, filename) => {
      if (filename === null || PROFILE_FILES.includes(String(filename))) refresh()
    })
  } catch {
    // The profile may be created lazily in a fresh DSH_HOME. Static guidance and
    // the restart tool remain available; the next process will retry watching.
  }

  return () => {
    clearTimeout(refreshTimer)
    watcher?.close()
    baseline = ''
  }
}

async function profileFingerprint(profilePath) {
  const contents = await Promise.all(PROFILE_FILES.map(async (file) => {
    try {
      return await readFile(join(profilePath, file), 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return ''
      throw error
    }
  }))
  return contents.join('\u0000')
}
