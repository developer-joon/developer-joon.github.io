import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, ConfigurationErrorScreen } from './App'
import { parseEnv } from './config/env'
import './styles/global.css'
import './styles/community.css'

const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('React root를 찾을 수 없습니다.')
}

let application = <App />

try {
  parseEnv(import.meta.env)
} catch {
  application = <ConfigurationErrorScreen />
}

createRoot(rootElement).render(<StrictMode>{application}</StrictMode>)
