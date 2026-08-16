const send = process.send.bind(process)
const post = (message) => {
  send(message, () => {
    if (process.connected) process.disconnect()
  })
}

process.on('disconnect', () => process.exit(0))
post({ kind: 'showing', threadId: 7 })

// Model the native COM Show call: the event loop cannot run the callback for
// `showing` until the dialog closes, at which point the worker posts `done`.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
post({ kind: 'done', path: 'C:\\workspace' })
