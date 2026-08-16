import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyHarnessRuntimeCompatibility, patchDirectoryPickerWorkerSource } from './src/main/runtime-compat.js'

const buggyWorker = `const post = (message) => {
  send(message, () => {
    if (process.connected) process.disconnect();
  });
};
process.on("disconnect", () => process.exit(0));`

const unsafeUtf16Worker = `function readUtf16(koffi, address) {
  const bytes = Buffer.from(koffi.view(address, 32768));
}
const getCurrentThreadId = kernel32.func("__stdcall", "GetCurrentThreadId", "uint32", []);
const path = readUtf16(koffi, nameOut[0]);`

describe('Harness runtime compatibility', () => {
  it('keeps the Win32 picker IPC open for the showing notice', () => {
    const result = patchDirectoryPickerWorkerSource(buggyWorker)
    expect(result.changed).toBe(true)
    expect(result.source).toContain('if (message.kind !== "showing" && process.connected) process.disconnect();')
  })

  it('is idempotent and leaves unrelated workers untouched', () => {
    const once = patchDirectoryPickerWorkerSource(buggyWorker)
    expect(patchDirectoryPickerWorkerSource(once.source)).toEqual({ source: once.source, changed: false })
    expect(patchDirectoryPickerWorkerSource('process.disconnect();')).toEqual({ source: 'process.disconnect();', changed: false })
  })

  it('bounds the native UTF-16 view to the selected path length', () => {
    const result = patchDirectoryPickerWorkerSource(unsafeUtf16Worker)
    expect(result.changed).toBe(true)
    expect(result.source).toContain('lstrlenW')
    expect(result.source).toContain('koffi.view(address, length * 2)')
    expect(result.source).toContain('readUtf16(koffi, nameOut[0], lstrlenW(nameOut[0]))')
    expect(patchDirectoryPickerWorkerSource(result.source)).toEqual({ source: result.source, changed: false })
  })

  it.skipIf(process.platform !== 'win32')('resolves a picker dependency nested beside the Harness package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-compat-'))
    try {
      const harnessEntry = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const pickerRoot = join(
        root,
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'node_modules',
        '@deepseek-ai',
        'dsh-host-directory-picker-native',
      )
      const workerPath = join(pickerRoot, 'lib', 'worker.cjs')
      await mkdir(join(harnessEntry, '..'), { recursive: true })
      await mkdir(join(pickerRoot, 'lib'), { recursive: true })
      await writeFile(harnessEntry, '', 'utf8')
      await writeFile(join(pickerRoot, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-host-directory-picker-native',
        main: 'lib/index.js',
      }), 'utf8')
      await writeFile(join(pickerRoot, 'lib', 'index.js'), '', 'utf8')
      await writeFile(workerPath, buggyWorker, 'utf8')

      await expect(applyHarnessRuntimeCompatibility(harnessEntry)).resolves.toBe(true)
      expect(await readFile(workerPath, 'utf8')).toContain('message.kind !== "showing"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
