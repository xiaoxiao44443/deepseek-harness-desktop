const desktopApi = window.desktop

if (!desktopApi) throw new Error('Desktop preload bridge is unavailable')

document.addEventListener('pointerdown', () => {
  void desktopApi.hideTitleMenu()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void desktopApi.hideTitleMenu()
})
