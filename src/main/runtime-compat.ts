import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const POST_START = 'const post = (message) => {'
const POST_END = '\n};'
const BUGGY_DISCONNECT = 'if (process.connected) process.disconnect();'
const GUARDED_DISCONNECT = 'if (message.kind !== "showing" && process.connected) process.disconnect();'
const UNBOUNDED_UTF16_READER = 'function readUtf16(koffi, address) {'
const BOUNDED_UTF16_READER = 'function readUtf16(koffi, address, length) {'
const UNBOUNDED_UTF16_VIEW = 'koffi.view(address, 32768)'
const BOUNDED_UTF16_VIEW = 'koffi.view(address, length * 2)'
const THREAD_ID_BINDING = 'const getCurrentThreadId = kernel32.func("__stdcall", "GetCurrentThreadId", "uint32", []);'
const UTF16_LENGTH_BINDING = 'const lstrlenW = kernel32.func("__stdcall", "lstrlenW", "int", ["void *"]);'
const UNBOUNDED_UTF16_CALL = 'readUtf16(koffi, nameOut[0])'
const BOUNDED_UTF16_CALL = 'readUtf16(koffi, nameOut[0], lstrlenW(nameOut[0]))'

export interface SourcePatchResult {
  source: string
  changed: boolean
}

/** Patch the two known rc.6 Win32 picker faults without touching newer sources. */
export function patchDirectoryPickerWorkerSource(source: string): SourcePatchResult {
  let patchedSource = source
  let changed = false

  if (!patchedSource.includes(GUARDED_DISCONNECT)) {
    const postStart = patchedSource.indexOf(POST_START)
    const postEnd = patchedSource.indexOf(POST_END, postStart)
    const disconnect = patchedSource.indexOf(BUGGY_DISCONNECT, postStart)
    if (postStart >= 0 && postEnd >= 0 && disconnect >= 0 && disconnect <= postEnd) {
      patchedSource = `${patchedSource.slice(0, disconnect)}${GUARDED_DISCONNECT}${patchedSource.slice(disconnect + BUGGY_DISCONNECT.length)}`
      changed = true
    }
  }

  const hasUnsafeUtf16Reader = [
    UNBOUNDED_UTF16_READER,
    UNBOUNDED_UTF16_VIEW,
    THREAD_ID_BINDING,
    UNBOUNDED_UTF16_CALL,
  ].every((token) => patchedSource.includes(token))
  if (!patchedSource.includes(BOUNDED_UTF16_READER) && hasUnsafeUtf16Reader) {
    patchedSource = patchedSource
      .replace(UNBOUNDED_UTF16_READER, BOUNDED_UTF16_READER)
      .replace(UNBOUNDED_UTF16_VIEW, BOUNDED_UTF16_VIEW)
      .replace(THREAD_ID_BINDING, `${THREAD_ID_BINDING}\n\t${UTF16_LENGTH_BINDING}`)
      .replace(UNBOUNDED_UTF16_CALL, BOUNDED_UTF16_CALL)
    changed = true
  }

  return { source: patchedSource, changed }
}

/**
 * Apply desktop compatibility fixes to one installed Harness runtime.
 * Missing/newer packages are intentionally a no-op; automatic Harness
 * updates are therefore safe and stop being modified once upstream fixes it.
 */
export async function applyHarnessRuntimeCompatibility(entryPath: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  let workerPath: string
  try {
    const pickerEntry = createRequire(entryPath).resolve('@deepseek-ai/dsh-host-directory-picker-native')
    workerPath = join(dirname(pickerEntry), 'worker.cjs')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'MODULE_NOT_FOUND') return false
    throw error
  }
  let source: string
  try {
    source = await readFile(workerPath, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') return false
    throw error
  }
  const patched = patchDirectoryPickerWorkerSource(source)
  if (!patched.changed) return false
  await writeFile(workerPath, patched.source, 'utf8')
  return true
}
