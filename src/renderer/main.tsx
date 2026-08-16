import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '../../shell.css'

const root = document.querySelector('#root')
if (!(root instanceof HTMLElement)) throw new Error('Desktop renderer root is unavailable')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
