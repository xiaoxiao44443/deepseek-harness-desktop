import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'

const MAX_REQUEST_BYTES = 16 * 1024

interface PickerRequest {
  title?: unknown
}

/**
 * Owns a loopback-only bridge from Harness' worker process to Electron's
 * native directory dialog. A random path token prevents other local pages
 * from invoking the picker, while keeping the managed Harness runtime
 * completely unmodified and safe to update.
 */
export class DirectoryPickerBridge {
  private server: Server | undefined
  private endpoint: string | undefined
  private lastDirectory: string | undefined

  constructor(
    private readonly parentWindow: () => BrowserWindow | undefined,
    private readonly statePath: string,
  ) {}

  async start(): Promise<string> {
    if (this.endpoint !== undefined) return this.endpoint
    this.lastDirectory = await this.loadLastDirectory()
    const token = randomBytes(24).toString('hex')
    const route = `/directory-picker/${token}`
    const server = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== route) {
        response.writeHead(404).end()
        return
      }
      void this.handleRequest(request, response)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Directory picker bridge did not bind a TCP port')
    this.endpoint = `http://127.0.0.1:${address.port}${route}`
    return this.endpoint
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.endpoint = undefined
    if (server === undefined) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleRequest(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_REQUEST_BYTES) throw new Error('Directory picker request is too large')
        chunks.push(buffer)
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PickerRequest
      const title = typeof payload.title === 'string' && payload.title.trim() !== ''
        ? payload.title
        : 'Select Workspace Directory'
      const options: OpenDialogOptions = {
        title,
        properties: ['openDirectory', 'createDirectory'],
        ...(this.lastDirectory !== undefined ? { defaultPath: this.lastDirectory } : {}),
      }
      const parent = this.parentWindow()
      const result = parent !== undefined && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      const selectedPath = result.canceled ? null : result.filePaths[0] ?? null
      if (selectedPath !== null) {
        this.lastDirectory = selectedPath
        await writeFile(this.statePath, selectedPath, 'utf8')
      }
      this.json(response, 200, { path: selectedPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.json(response, 500, { error: message })
    }
  }

  private json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  private async loadLastDirectory(): Promise<string | undefined> {
    try {
      const path = (await readFile(this.statePath, 'utf8')).trim()
      if (path === '' || !(await stat(path)).isDirectory()) return undefined
      return path
    } catch {
      return undefined
    }
  }
}
