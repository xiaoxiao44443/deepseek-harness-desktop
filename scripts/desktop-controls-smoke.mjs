import { findDesktopTarget } from './desktop-target.mjs'

const port = process.argv[2] ?? '9223'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const target = findDesktopTarget(targets)
if (!target) throw new Error('Shell target not found')

async function evaluate(expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
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
      params: { expression, returnByValue: true, awaitPromise: true },
    }))
  })
  socket.close()
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text)
  return response.result?.result?.value
}

const minimizeOnly = process.argv[3] === 'minimize-only'
if (minimizeOnly) {
  await evaluate(`window.desktop.windowAction('minimize')`)
  console.log(JSON.stringify({ minimizeRequested: true }))
  process.exit(0)
}
if (process.argv[3] === 'close-only') {
  await evaluate(`(setTimeout(() => { void window.desktop.windowAction('close') }, 50), true)`)
  console.log(JSON.stringify({ closeRequested: true }))
  process.exit(0)
}

const states = JSON.parse(await evaluate(`(async () => {
  const wait = () => new Promise(resolve => setTimeout(resolve, 350))
  const before = await window.desktop.getState()
  document.querySelector('#maximize').click()
  await wait()
  const maximized = await window.desktop.getState()
  document.querySelector('#maximize').click()
  await wait()
  const restored = await window.desktop.getState()
  document.querySelector('#minimize').click()
  await wait()
  return JSON.stringify({ before, maximized, restored, minimizeRequested: true })
})()`))
console.log(JSON.stringify(states, null, 2))
