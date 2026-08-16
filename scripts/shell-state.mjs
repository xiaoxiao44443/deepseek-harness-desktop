import { findDesktopTarget } from './desktop-target.mjs'

const port = process.argv[2] ?? '9228'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const shellTarget = findDesktopTarget(targets)
if (!shellTarget) throw new Error('Shell target not found')

const socket = new WebSocket(shellTarget.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

const response = await new Promise((resolve, reject) => {
  socket.onerror = reject
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id === 1) resolve(message)
  }
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `(async () => JSON.stringify({
        state: await window.desktop.getState(),
        startupHidden: document.querySelector('.startup')?.hidden,
        startupTitle: document.querySelector('#startup-title')?.textContent,
        startupMessage: document.querySelector('#startup-message')?.textContent,
      }))()`,
      returnByValue: true,
      awaitPromise: true,
    },
  }))
})

socket.close()
if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text)
console.log(JSON.stringify(JSON.parse(response.result.result.value), null, 2))
