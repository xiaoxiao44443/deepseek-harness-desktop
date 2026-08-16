export function findDesktopTarget(targets) {
  return targets.find(target => {
    try {
      const url = new URL(target.url)
      if (url.protocol === 'file:') return url.pathname.replaceAll('\\', '/').endsWith('/dist/renderer/index.html')
      return url.hostname === '127.0.0.1' && url.port === '5173'
    } catch {
      return false
    }
  })
}

export function findHarnessTarget(targets, desktopTarget) {
  return targets.find(target => target !== desktopTarget && /^http:\/\/127\.0\.0\.1:\d+/.test(target.url))
}
