import childProcess from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { createRequire, registerHooks, syncBuiltinESMExports } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const electronExecutable = process.execPath.toLowerCase()
const originalSpawn = childProcess.spawn
const directoryPickerWorkerShim = join(__dirname, 'directory-picker-worker.cjs')
const DESKTOP_BRIDGE_PACKAGE = 'dsh-desktop-bridge'

interface KoffiLibrary {
  func(declaration: string): (...args: unknown[]) => unknown
}

interface KoffiModule {
  load(name: string): KoffiLibrary
}

/**
 * DeepSeek Harness' Windows ACL runner deliberately makes restricted children
 * share their host console. Without one, PowerShell terminates during DLL
 * initialization with STATUS_DLL_INIT_FAILED (0xC0000142). A packaged Electron
 * GUI has no console by default, so create one for the background Harness Node
 * process and immediately hide its window. This preserves the ACL sandbox and
 * does not require weakening sessions to danger-full-access.
 */
function ensureHiddenHarnessConsole(harnessEntry: string): void {
  if (process.platform !== 'win32') return
  try {
    const requireFromHarness = createRequire(harnessEntry)
    const koffi = requireFromHarness('koffi') as KoffiModule
    const kernel32 = koffi.load('kernel32.dll')
    const user32 = koffi.load('user32.dll')
    const getConsoleWindow = kernel32.func('void * __stdcall GetConsoleWindow()') as () => unknown
    const allocConsole = kernel32.func('bool __stdcall AllocConsole()') as () => boolean
    const showWindow = user32.func('bool __stdcall ShowWindow(void *window, int command)') as (window: unknown, command: number) => boolean

    let consoleWindow = getConsoleWindow()
    if (!consoleWindow && allocConsole()) {
      consoleWindow = getConsoleWindow()
      if (consoleWindow) showWindow(consoleWindow, 0)
    }
  } catch (error) {
    console.warn('[desktop] failed to prepare the hidden Harness console', error)
  }
}

function isHarnessDirectoryPickerWorker(entry: string | undefined): entry is string {
  if (entry === undefined) return false
  const normalized = entry.replaceAll('\\', '/').toLowerCase()
  return normalized.endsWith('/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs')
}

/**
 * Harness occasionally launches a JavaScript worker through process.execPath
 * (for example, the Win32 directory picker). Since process.execPath is Electron
 * in the desktop bundle, only those self-spawned workers need Node mode. Other
 * applications such as VS Code must not inherit Electron's Node-mode flag.
 */
function desktopSpawn(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  if (String(command).toLowerCase() === electronExecutable) {
    // Harness rc.6 disconnects the Win32 folder picker's IPC channel after
    // its non-terminal `showing` notice. The compatibility worker keeps that
    // channel alive until `done`/`error`. Matching the package entry instead
    // of a runtime root makes this apply to both bundled and updated Harness.
    const workerArgs = process.platform === 'win32' && isHarnessDirectoryPickerWorker(args[0])
      ? [directoryPickerWorkerShim, args[0], ...args.slice(1)]
      : args
    return originalSpawn(command, workerArgs, {
      ...options,
      env: {
        ...process.env,
        ...options.env,
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
    })
  }
  return originalSpawn(command, args, options)
}
childProcess.spawn = desktopSpawn as typeof childProcess.spawn
syncBuiltinESMExports()

/**
 * The active DSH Profile is the ESM import base for loader entries, so Node's
 * legacy NODE_PATH cannot expose an app-bundled package to it. Keep the bridge
 * package outside ~/.dsh and resolve only its three public entry points here.
 * This preserves a real package name for DSH's client-module inventory while
 * avoiding any mutation of the user's Profile dependencies.
 */
function registerDesktopBridgeResolver(): void {
  const root = process.env.DSH_DESKTOP_BRIDGE_ROOT
  if (root === undefined) return
  if (!isAbsolute(root)) throw new Error('DSH_DESKTOP_BRIDGE_ROOT must be absolute')
  const entries = new Map<string, string>([
    [DESKTOP_BRIDGE_PACKAGE, join(root, 'lib', 'index.js')],
    [`${DESKTOP_BRIDGE_PACKAGE}/client`, join(root, 'lib', 'client.js')],
    [`${DESKTOP_BRIDGE_PACKAGE}/package.json`, join(root, 'package.json')],
  ])
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const entry = entries.get(specifier)
      if (entry !== undefined) return { url: pathToFileURL(entry).href, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
}

/**
 * Electron is used as the bundled Node executable for Harness. The mode flag
 * is only needed while Electron boots; leaving it in the environment breaks
 * native openers when the selected editor is itself an Electron application.
 */
async function bootstrap(): Promise<void> {
  const harnessEntry = process.argv[2]
  if (harnessEntry === undefined) throw new Error('Harness entry path was not provided')

  const harnessArgs = process.argv.slice(3)
  ensureHiddenHarnessConsole(harnessEntry)
  registerDesktopBridgeResolver()
  delete process.env.ELECTRON_RUN_AS_NODE
  delete process.env.ELECTRON_NO_ATTACH_CONSOLE
  process.argv = [process.execPath, harnessEntry, ...harnessArgs]
  await import(pathToFileURL(harnessEntry).href)
}

void bootstrap()
