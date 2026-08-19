import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserWindowApp } from './BrowserWindowApp.js'
import './browser-window.css'

const theme = new URLSearchParams(window.location.search).get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme

const root = document.querySelector('#root')
if (!(root instanceof HTMLElement)) throw new Error('Browser window renderer root is unavailable')

createRoot(root).render(
  <StrictMode>
    <BrowserWindowApp />
  </StrictMode>,
)
