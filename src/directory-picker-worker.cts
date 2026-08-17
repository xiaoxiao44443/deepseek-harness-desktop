/** Desktop directory-picker worker compatible with Harness' worker protocol. */
const originalWorker = process.argv[2]
if (originalWorker === undefined) throw new Error('Directory picker worker path was not provided')

const rawSend = process.send?.bind(process)
if (rawSend === undefined) throw new Error('Directory picker compatibility worker requires IPC')

const endpoint = process.env.DSH_DESKTOP_DIRECTORY_PICKER_URL

const post = (message: unknown): void => {
  Reflect.apply(rawSend, process, [message, () => {
    if (process.connected) process.disconnect()
  }])
}

if (endpoint === undefined || endpoint === '') {
  // Keep the launcher useful outside the desktop host and for upstream tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(originalWorker)
} else {
  const title = process.env.DSH_DIALOG_TITLE?.trim()
  void (async () => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(title === undefined || title === '' ? {} : { title }),
      })
      const payload = await response.json() as { path?: unknown, error?: unknown }
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`)
      post({ kind: 'done', path: typeof payload.path === 'string' ? payload.path : null })
    } catch (error) {
      post({
        kind: 'error',
        message: error instanceof Error ? error.stack ?? error.message : String(error),
      })
    }
  })()
}
