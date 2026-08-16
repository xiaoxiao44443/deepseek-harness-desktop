const port = process.argv[2] ?? '9223'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const target = targets.find(candidate => candidate.url.startsWith('file:'))
if (!target) throw new Error('Shell target not found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
const events = []
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') {
    events.push(message)
  }
}
socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
socket.send(JSON.stringify({ id: 2, method: 'Page.enable' }))
await new Promise(resolve => setTimeout(resolve, 100))
socket.send(JSON.stringify({ id: 3, method: 'Page.reload', params: { ignoreCache: true } }))
await new Promise(resolve => setTimeout(resolve, 1_500))
console.log(JSON.stringify(events, null, 2))
socket.close()
