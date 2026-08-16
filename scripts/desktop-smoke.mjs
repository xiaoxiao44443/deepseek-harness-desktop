import { findDesktopTarget, findHarnessTarget } from './desktop-target.mjs'

const port = process.argv[2] ?? '9223'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const shellTarget = findDesktopTarget(targets)
const harnessTarget = findHarnessTarget(targets, shellTarget)
if (!shellTarget || !harnessTarget) throw new Error('Desktop CDP targets are incomplete')

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

const shell = await evaluate(shellTarget, `(async () => JSON.stringify({
  desktop: typeof window.desktop,
  state: await window.desktop.getState(),
  theme: document.documentElement.dataset.theme,
  versionLabel: document.querySelector('#version-label')?.textContent,
  reloadPresent: Boolean(document.querySelector('#reload')),
  maximized: document.body.classList.contains('maximized'),
  titleMenu: Boolean(document.querySelector('#title-menu')),
  controls: [...document.querySelectorAll('.window-button')].map(button => {
    const rect = button.getBoundingClientRect()
    return {
      id: button.id,
      disabled: button.disabled,
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button')?.id,
    }
  }),
}))()`)
const harness = await evaluate(harnessTarget, `JSON.stringify({
  bodyDark: document.body.hasAttribute('data-ds-dark-theme'),
  inlineScheme: document.documentElement.style.colorScheme,
  computedScheme: getComputedStyle(document.documentElement).colorScheme,
})`)
console.log(JSON.stringify({ shell: JSON.parse(shell), harness: JSON.parse(harness) }, null, 2))
