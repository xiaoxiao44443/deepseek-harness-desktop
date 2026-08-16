const port = process.argv[2] ?? '9225'
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function targets() {
  return fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
}

async function evaluate(target, expression) {
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

const allTargets = await targets()
const shellTarget = findDesktopTarget(allTargets)
const harnessTarget = findHarnessTarget(allTargets, shellTarget)
if (!shellTarget || !harnessTarget) throw new Error('Desktop targets are incomplete')

await evaluate(shellTarget, `window.desktop.windowAction('toggle-maximize')`)
await sleep(350)
const maximized = await evaluate(shellTarget, `window.desktop.getState()`)
await evaluate(shellTarget, `window.desktop.windowAction('toggle-maximize')`)
await sleep(350)
const restored = await evaluate(shellTarget, `window.desktop.getState()`)

await evaluate(shellTarget, `document.querySelector('#title-menu').click()`)
await sleep(250)
const menuVisibleState = await evaluate(shellTarget, `Boolean(document.querySelector('#title-menu-popover'))`)
await evaluate(shellTarget, `document.querySelector('.menu-backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`)
await sleep(250)
const menuHiddenState = await evaluate(shellTarget, `Boolean(document.querySelector('#title-menu-popover'))`)
const harnessViewport = JSON.parse(await evaluate(harnessTarget, `JSON.stringify({ width: innerWidth, height: innerHeight })`))

console.log(JSON.stringify({
  maximized: maximized.isMaximized,
  restored: restored.isMaximized,
  menuVisibleState,
  menuHiddenState,
  harnessViewport,
}, null, 2))
import { findDesktopTarget, findHarnessTarget } from './desktop-target.mjs'
