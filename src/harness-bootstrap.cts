import childProcess from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const electronExecutable = process.execPath.toLowerCase()
const originalSpawn = childProcess.spawn
const directoryPickerWorkerShim = join(__dirname, 'directory-picker-worker.cjs')

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
 * Electron is used as the bundled Node executable for Harness. The mode flag
 * is only needed while Electron boots; leaving it in the environment breaks
 * native openers when the selected editor is itself an Electron application.
 */
async function bootstrap(): Promise<void> {
  const harnessEntry = process.argv[2]
  if (harnessEntry === undefined) throw new Error('Harness entry path was not provided')

  const harnessArgs = process.argv.slice(3)
  ensureHiddenHarnessConsole(harnessEntry)
  delete process.env.ELECTRON_RUN_AS_NODE
  delete process.env.ELECTRON_NO_ATTACH_CONSOLE
  process.argv = [process.execPath, harnessEntry, ...harnessArgs]
  await import(pathToFileURL(harnessEntry).href)
}

void bootstrap()
