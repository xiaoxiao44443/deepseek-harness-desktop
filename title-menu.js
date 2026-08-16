const desktopApi = window.desktop

const elements = {
  harnessVersion: document.querySelector('#harness-version'),
  desktopVersion: document.querySelector('#desktop-version'),
  updateAction: document.querySelector('#update-action'),
  updateTitle: document.querySelector('#update-title'),
  updateDetail: document.querySelector('#update-detail'),
  updateDot: document.querySelector('#update-dot'),
  releaseNotesAction: document.querySelector('#release-notes-action'),
}

if (!desktopApi) throw new Error('Desktop preload bridge is unavailable')

function render(state) {
  document.documentElement.dataset.theme = state.theme
  elements.harnessVersion.textContent = state.harnessVersion ?? '尚未启动'
  elements.desktopVersion.textContent = state.appVersion
  elements.updateAction.disabled = state.updateStatus === 'checking' || state.updateStatus === 'downloading'
  elements.updateDot.className = 'item-dot'

  if (state.updateStatus === 'ready') {
    elements.updateTitle.textContent = '重启并应用更新'
    elements.updateDetail.textContent = state.updateVersion ?? ''
    elements.updateDot.classList.add('active', 'ready')
  } else if (state.updateStatus === 'checking') {
    elements.updateTitle.textContent = '正在检查更新…'
    elements.updateDetail.textContent = ''
    elements.updateDot.classList.add('active', 'busy')
  } else if (state.updateStatus === 'downloading') {
    elements.updateTitle.textContent = '正在下载更新…'
    elements.updateDetail.textContent = state.updateVersion ?? ''
    elements.updateDot.classList.add('active', 'busy')
  } else if (state.updateStatus === 'error') {
    elements.updateTitle.textContent = '重新检查更新'
    elements.updateDetail.textContent = '上次失败'
    elements.updateDot.classList.add('active', 'error')
  } else if (state.updateStatus === 'current') {
    elements.updateTitle.textContent = '检查 Harness 更新'
    elements.updateDetail.textContent = '已是最新'
    elements.updateDot.classList.add('active', 'ready')
  } else {
    elements.updateTitle.textContent = '检查 Harness 更新'
    elements.updateDetail.textContent = ''
  }
}

async function runAction(action, button) {
  button.blur()
  await desktopApi.titleMenuAction(action)
}

elements.updateAction.addEventListener('click', () => runAction('update', elements.updateAction))
elements.releaseNotesAction.addEventListener('click', () => runAction('release-notes', elements.releaseNotesAction))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void desktopApi.hideTitleMenu()
})
desktopApi.onState(render)
desktopApi.getState().then(render)
