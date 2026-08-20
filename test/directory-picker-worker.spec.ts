import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('directory picker IPC compatibility worker', () => {
  it('keeps IPC connected between showing and the selected path', async () => {
    const child = spawn(process.execPath, [
      resolve('src/directory-picker-worker.cts'),
      resolve('scripts/fixtures/upstream-directory-picker-worker.cjs'),
    ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })

    const messages: unknown[] = []
    child.on('message', (message) => messages.push(message))
    const result = await new Promise<{ code: number | null, stderr: string }>((resolveExit, reject) => {
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.once('error', reject)
      child.once('exit', (code) => resolveExit({ code, stderr }))
    })

    expect(result).toEqual({ code: 0, stderr: '' })
    expect(messages).toEqual([
      { kind: 'showing', threadId: 7 },
      { kind: 'done', path: 'C:\\workspace' },
    ])
  }, 15_000)

  it('uses the desktop picker bridge instead of loading the native worker', async () => {
    let requestBody = ''
    const server = createServer((request, response) => {
      request.on('data', (chunk: Buffer) => { requestBody += chunk.toString('utf8') })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ path: 'E:\\workspace' }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test bridge failed to bind')

    const child = spawn(process.execPath, [
      resolve('src/directory-picker-worker.cts'),
      resolve('scripts/fixtures/upstream-directory-picker-worker.cjs'),
    ], {
      env: {
        ...process.env,
        DSH_DIALOG_TITLE: 'Choose a test workspace',
        DSH_DESKTOP_DIRECTORY_PICKER_URL: `http://127.0.0.1:${address.port}/`,
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })

    const messages: unknown[] = []
    child.on('message', (message) => messages.push(message))
    const result = await new Promise<{ code: number | null, stderr: string }>((resolveExit, reject) => {
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.once('error', reject)
      child.once('exit', (code) => resolveExit({ code, stderr }))
    })
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))

    expect(result).toEqual({ code: 0, stderr: '' })
    expect(JSON.parse(requestBody)).toEqual({ title: 'Choose a test workspace' })
    expect(messages).toEqual([{ kind: 'done', path: 'E:\\workspace' }])
  }, 15_000)
})
