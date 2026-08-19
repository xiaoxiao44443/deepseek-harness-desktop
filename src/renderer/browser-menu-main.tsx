import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserMenuApp } from './BrowserMenuApp.js'
import './browser-menu.css'

const theme = new URLSearchParams(window.location.search).get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme

const root = document.querySelector('#root')
if (!(root instanceof HTMLElement)) throw new Error('Browser menu renderer root is unavailable')

createRoot(root).render(
  <StrictMode>
    <BrowserMenuApp />
  </StrictMode>,
)
