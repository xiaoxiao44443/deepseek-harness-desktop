import { app, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { HarnessProcess } from './harness-process.js'
import { DESKTOP_PNPM_VERSION, HarnessRuntimeManager } from './harness-runtime.js'
import { WindowController } from './window-controller.js'
import { DirectoryPickerBridge } from './directory-picker-bridge.js'
import { HarnessToolchainManager } from './harness-toolchain.js'
import { DevelopmentService } from './development-service.js'
import type { DevelopmentSettings } from './development-settings.js'

app.setName('DeepSeek Harness')
if (process.platform === 'win32') app.setAppUserModelId('com.saltfish.deepseek-harness-desktop')

const desktopUserDataPath = join(
  app.getPath('home'),
  '.saltfish',
  'deepseek-harness-desktop',
)

// Keep desktop-owned state portable and clearly separate from Harness' official
// ~/.dsh home on Windows, macOS, and Linux.
mkdirSync(desktopUserDataPath, { recursive: true })
app.setPath('userData', desktopUserDataPath)
app.setPath('sessionData', desktopUserDataPath)

// GUI applications may inherit a short-lived terminal pipe when launched by a
// package runner. Once that runner exits, writing to stdout/stderr emits EPIPE.
// Never let a diagnostic stream take down the desktop main process.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      // There is deliberately no fallback write here: it could recurse through
      // the same broken stream. Runtime failures are surfaced in the window.
    }
  })
}

const debugLog = (...values: unknown[]): void => {
  if (!app.isPackaged) console.log(...values)
}

const debugError = (...values: unknown[]): void => {
  if (!app.isPackaged) console.error(...values)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let harness: HarnessProcess | undefined
  let windows: WindowController | undefined
  let runtime: HarnessRuntimeManager | undefined
  let directoryPicker: DirectoryPickerBridge | undefined
  let development: DevelopmentService | undefined
  let quitting = false

  app.on('second-instance', () => windows?.focus())
  app.on('before-quit', () => {
    quitting = true
    runtime?.stopAutomaticChecks()
    void harness?.stop()
    void directoryPicker?.stop()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('activate', () => { if (!quitting) void windows?.create() })

  const bootstrap = async (): Promise<void> => {
    debugLog('[desktop] waiting for Electron ready')
    await app.whenReady()
    debugLog('[desktop] Electron ready; resolving Harness runtime')
    const bundledRuntimeRoot = app.isPackaged
      ? join(app.getPath('userData'), 'harness-runtime', 'bundled', app.getVersion())
      : undefined
    const bundledArchivePath = app.isPackaged ? join(process.resourcesPath, 'harness-runtime.tgz') : undefined
    const packagedNpmCli = app.isPackaged
      ? join(bundledRuntimeRoot as string, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : undefined
    runtime = new HarnessRuntimeManager(
      app.getPath('userData'),
      process.execPath,
      bundledRuntimeRoot,
      bundledArchivePath,
      packagedNpmCli,
    )
    await runtime.initialize()
    const launchHarness = async (settings: DevelopmentSettings): Promise<void> => {
      if (runtime === undefined || windows === undefined || harness === undefined) {
        throw new Error('桌面运行时尚未准备完成。')
      }
      let started = false
      const failures: string[] = []
      for (const candidate of await runtime.launchCandidates()) {
        windows.setHarnessStarting(candidate.version)
        try {
          const running = await harness.start(candidate, settings)
          await runtime.markHealthy(candidate)
          development?.setHarnessVersion(candidate.version)
          await windows.showHarness(running.url, candidate.version)
          debugLog(`[desktop] Harness ${candidate.version} ready at ${running.url}`)
          started = true
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push(`${candidate.version} (${candidate.source}): ${message}`)
          // A user-supplied patch can fail independently from the runtime. Do
          // not blacklist an otherwise healthy auto-updated Harness version.
          if (settings.patchPath === undefined) await runtime.markFailed(candidate, message)
        }
      }
      if (!started) {
        const message = `无法启动 DeepSeek Harness。${failures.join('；')}`
        windows.setHarnessError(message)
        throw new Error(message)
      }
    }

    development = new DevelopmentService(
      join(app.getPath('userData'), 'development.json'),
      DESKTOP_PNPM_VERSION,
      {
        getWindow: () => windows?.getBrowserWindow(),
        restartHarness: launchHarness,
        runPlugin: async (profile, args) => {
          if (harness === undefined) throw new Error('Harness 尚未启动。')
          return await harness.runPlugin(profile, args)
        },
      },
    )
    await development.initialize()
    debugLog('[desktop] Harness runtime resolved; creating window')
    windows = new WindowController(runtime, development)
    await windows.create()
    debugLog('[desktop] window created; starting Harness')

    directoryPicker = new DirectoryPickerBridge(
      () => windows?.getBrowserWindow(),
      join(app.getPath('userData'), 'last-workspace-directory.txt'),
    )
    const directoryPickerUrl = await directoryPicker.start()
    const toolchain = new HarnessToolchainManager(app.getPath('userData'), process.execPath)
    harness = new HarnessProcess(
      process.execPath,
      app.getPath('home'),
      directoryPickerUrl,
      toolchain,
    )
    harness.on('log', (stream: string, message: string) => {
      const output = `[harness:${stream}] ${message.trimEnd()}`
      if (stream === 'stderr') debugError(output)
      else debugLog(output)
    })
    harness.on('exit', ({ expected }: { expected: boolean }) => {
      if (!expected && !quitting) windows?.setHarnessError('Harness 后台进程已意外退出。请重新启动应用。')
    })

    try {
      await launchHarness(development.currentSettings)
      runtime.scheduleAutomaticChecks(2_000)
    } catch {
      // launchHarness already surfaced a recoverable error in the shell. The
      // development dialog remains available so a bad patch can be cleared.
    }
  }

  void bootstrap().catch((error: unknown) => {
    debugError('[desktop] fatal startup error', error)
    if (app.isPackaged) {
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('DeepSeek Harness 启动失败', message)
    }
    app.quit()
  })
}
