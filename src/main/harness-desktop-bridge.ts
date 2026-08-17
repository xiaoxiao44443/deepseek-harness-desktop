import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const CONTROL_HOST = '127.0.0.1'
const MAX_REQUEST_BYTES = 16_384
const DEFAULT_RESTART_DELAY_MS = 1_500

export interface HarnessDesktopBridgeLaunch {
  patchPath: string
  controlUrl: string
  controlToken: string
  profilePath: string
}

export interface HarnessDesktopBridgeOptions {
  userDataPath: string
  pluginEntryPath: string
  profilePath: string
  restartHarness(reason: string): Promise<void>
  restartDelayMs?: number
}

/**
 * Owns the authenticated loopback seam used by the in-process DSH Host plugin.
 * The plugin can request a restart, but only the Electron parent owns the child
 * process and can perform it safely.
 */
export class HarnessDesktopBridgeHost {
  private server: Server | undefined
  private launch: HarnessDesktopBridgeLaunch | undefined
  private restartTimer: NodeJS.Timeout | undefined
  private restartPending = false

  constructor(private readonly options: HarnessDesktopBridgeOptions) {}

  async start(): Promise<HarnessDesktopBridgeLaunch> {
    if (this.launch !== undefined) return { ...this.launch }
    if (!isAbsolute(this.options.pluginEntryPath)) throw new Error('Desktop bridge plugin entry must be absolute')

    const patchPath = join(this.options.userDataPath, 'desktop-bridge.patch.json')
    await mkdir(this.options.userDataPath, { recursive: true })
    await writeFile(patchPath, `${JSON.stringify([
      {
        insert: [
          { id: 'desktop-bridge', name: this.options.pluginEntryPath },
        ],
      },
    ], null, 2)}\n`, 'utf8')

    const controlToken = randomBytes(32).toString('hex')
    const server = createServer((request, response) => {
      void this.handleRequest(request, response, controlToken).catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy()
          return
        }
        this.sendJson(response, 500, {
          accepted: false,
          message: error instanceof Error ? error.message : String(error),
        })
      })
    })
    this.server = server

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, CONTROL_HOST)
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      await this.stop()
      throw new Error('Desktop bridge did not bind a TCP port')
    }
    this.launch = {
      patchPath,
      controlUrl: `http://${CONTROL_HOST}:${address.port}/v1/restart-harness`,
      controlToken,
      profilePath: this.options.profilePath,
    }
    return { ...this.launch }
  }

  async stop(): Promise<void> {
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    this.restartPending = false
    this.launch = undefined
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    controlToken: string,
  ): Promise<void> {
    if (request.url !== '/v1/restart-harness') {
      this.sendJson(response, 404, { accepted: false, message: 'Not found' })
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      this.sendJson(response, 405, { accepted: false, message: 'Method not allowed' })
      return
    }
    if (request.headers.authorization !== `Bearer ${controlToken}`) {
      this.sendJson(response, 401, { accepted: false, message: 'Unauthorized' })
      return
    }

    const body = await this.readJsonBody(request)
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : '加载已变更的 Harness 插件配置'

    if (this.restartPending) {
      this.sendJson(response, 202, { accepted: true, message: 'Harness restart is already scheduled' })
      return
    }

    this.restartPending = true
    this.sendJson(response, 202, { accepted: true, message: 'Harness restart scheduled' })
    const delay = this.options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.options.restartHarness(reason)
        .catch(() => undefined)
        .finally(() => {
          this.restartPending = false
        })
    }, delay)
    this.restartTimer.unref()
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = ''
    for await (const chunk of request) {
      raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) throw new Error('Request body is too large')
    }
    if (raw.trim().length === 0) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Request body must be a JSON object')
    }
    return parsed as Record<string, unknown>
  }

  private sendJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
    response.statusCode = status
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(`${JSON.stringify(value)}\n`)
  }
}
