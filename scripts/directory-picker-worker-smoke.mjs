import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const electron = resolve(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const shim = resolve(projectRoot, 'dist', 'directory-picker-worker.cjs')
const bundledWorker = resolve(
  projectRoot,
  'build',
  'harness-runtime',
  'node_modules',
  '@deepseek-ai',
  'dsh-host-directory-picker-native',
  'lib',
  'worker.cjs',
)
const worker = process.env.DSH_PICKER_WORKER || bundledWorker
const workerArgs = process.env.DSH_PICKER_DIRECT === '1' ? [worker] : [shim, worker]

const child = spawn(electron, workerArgs, {
  env: {
    ...process.env,
    DSH_DIALOG_TITLE: 'DFY DSH Desktop Directory Picker Smoke',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  windowsHide: true,
})

const timeout = setTimeout(() => {
  child.kill()
  process.exitCode = 1
  console.error('[directory-picker-smoke] timed out')
}, 30_000)

child.on('message', (message) => {
  console.log(`[directory-picker-smoke] ${JSON.stringify(message)}`)
  if (message?.kind === 'done') {
    clearTimeout(timeout)
    process.exitCode = 0
  } else if (message?.kind === 'error') {
    clearTimeout(timeout)
    process.exitCode = 1
  }
})

child.once('error', (error) => {
  clearTimeout(timeout)
  process.exitCode = 1
  console.error(error)
})

child.once('exit', (code, signal) => {
  clearTimeout(timeout)
  if (process.exitCode === undefined) process.exitCode = code === 0 ? 0 : 1
  console.log(`[directory-picker-smoke] exit ${String(code ?? signal)}`)
})
