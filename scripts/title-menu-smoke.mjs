import { findDesktopTarget } from './desktop-target.mjs'

const port = process.argv[2] ?? '9224'

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

const initialTargets = await targets()
const shellTarget = findDesktopTarget(initialTargets)
if (!shellTarget) throw new Error('Shell target not found')

const result = JSON.parse(await evaluate(shellTarget, `(async () => {
  const titlebar = document.querySelector('.titlebar')
  document.querySelector('#title-menu').click()
  await new Promise(resolve => setTimeout(resolve, 120))
  const popover = document.querySelector('#title-menu-popover')
  if (!popover) throw new Error('Title menu did not render')
  const card = popover
  const value = {
    shell: {
      activeElement: document.activeElement?.id || document.activeElement?.tagName,
      titlebarBackground: getComputedStyle(titlebar).backgroundImage,
      titlebarColor: getComputedStyle(titlebar).color,
      backButtonPresent: Boolean(document.querySelector('#back')),
      forwardButtonPresent: Boolean(document.querySelector('#forward')),
      reloadButtonPresent: Boolean(document.querySelector('#reload')),
    },
    menu: {
      visible: true,
      harnessVersion: (await window.desktop.getState()).harnessVersion,
      updateTitle: document.querySelector('#update-title')?.textContent,
      developmentItemPresent: Boolean(document.querySelector('#development-action')),
      developmentItemDisabled: document.querySelector('#development-action')?.disabled,
      developmentItemHit: (() => {
        const item = document.querySelector('#development-action')
        const rect = item?.getBoundingClientRect()
        return rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button')?.id : undefined
      })(),
      cardBackground: getComputedStyle(card).backgroundColor,
      cardBackdropFilter: getComputedStyle(card).webkitBackdropFilter || getComputedStyle(card).backdropFilter,
      cardRadius: getComputedStyle(card).borderRadius,
    },
  }
  document.querySelector('#title-menu').click()
  return JSON.stringify(value)
})()`))
console.log(JSON.stringify(result, null, 2))
